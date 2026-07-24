// GPU 烘焙器(P1-2 AO/天光 + P1-3 可见度通道 + P1-4 一次弹射/发光注入)。
// 三个 pass,全部 raw WebGL2(借 three 的 GL 上下文,结束 renderer.resetState() 交还):
//   ① AO/天光:每探针 N 条 Fibonacci 球面射线,4cm DDA(限程 2.5m)+ 解析房间界 → L1 矩
//   ② 可见度:每探针 → ≤8 盏灯(槽 0/1 主灯:吊灯/炉火;槽 2-7 发光素材聚成的虚拟点光,
//      E.3 扩容)的软阴影可见度(面光抖动影线),两张 RGBA 各管 4 盏;空槽 uniform 分支跳过,
//      烘焙成本随实际灯数走
//   ③ 弹射 gather(E.2 起迭代多代,默认 2):gen1 = 每探针 N 条射线打到最近表面,取
//      「反照率 × 该点直射受光(4 灯×可见度 + 环境×AO + 太阳)」;gen≥2 = 同样的射线,
//      但命中点改采**上一代弹射场**的 L1 辐照 —— 每代恰好多弹一跳,累加见 bounceK 注释
// 输出(运行时常驻):SH 体积 **3 张打包** Data3DTexture(E.5:12 通道恰填 3×RGBA,
// 少一次逐片元采样;值 = AO矩×环境色 + 弹射矩,环境色在烘焙期折入——运行时
// irradiance(n) = m0 + 2·m1·n 直接用,不再乘 ambient);可见度 RGBA 2 张。
// 每探针另留 CPU 副本(sampleM0/sampleVis)做数值验收与 E2E 断言。
// 布局:0.4m 探针 64×26×64 盖 25.6×10.4×25.6(=域范围);逐 z 层 MRT 渲 64×26 小 FBO
// → readPixels 回读(烘焙离线一次性,回读慢无所谓)→ 打包 half(float 线性过滤非核心,half 是)。
import * as THREE from 'three';
import { DOMAIN } from './domain.js';

// 光照体积探针网格:默认 0.4m,盖 25.6×10.4×25.6(=域范围)。
// E.4 加密选项:?voxprobe=0.3(薄墙漏光减轻;0.3 时探针 ×2.4、体积内存 ~50MB)。
// 必须模块加载期定死——patch.js 的 EXT 归一化常量烤在 shader 源码里且与本 VOL 同源,
// 逐次烘焙切换会让已编译材质的采样范围错位;改密度 = 刷新页面。Node 端(单测)恒默认。
const PROBE_CELL = (() => {
  if (typeof window === 'undefined') return 0.4;
  const v = parseFloat(new URLSearchParams(window.location.search).get('voxprobe'));
  return v >= 0.2 && v <= 0.4 ? v : 0.4;
})();
export const VOL = {
  cell: PROBE_CELL,
  nx: Math.round(25.6 / PROBE_CELL),
  ny: Math.round(10.4 / PROBE_CELL),
  nz: Math.round(25.6 / PROBE_CELL),
};

const RAYS_DEFAULT = 64;
function fibDirs(n) {
  // Fibonacci 球面均匀方向
  const a = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const t = ga * i;
    a.push(Math.cos(t) * r, y, Math.sin(t) * r);
  }
  return new Float32Array(a);
}

const VS = `#version 300 es
void main() {
  // 无 VBO 全屏三角
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// 共用 GLSL 头:占位查询 + 常量 + DDA(三个 pass 一致)
const COMMON = `
const vec3 ORG = vec3(${DOMAIN.origin[0].toFixed(3)}, ${DOMAIN.origin[1].toFixed(3)}, ${DOMAIN.origin[2].toFixed(3)});
const float CELL = ${DOMAIN.cell.toFixed(4)};
const ivec3 N = ivec3(${DOMAIN.nx}, ${DOMAIN.ny}, ${DOMAIN.nz});
const float VCELL = ${VOL.cell.toFixed(3)};
// VEXT = 体积纹理覆盖范围 = VOL 网格(n·cell,y=10.4),不是 DOMAIN 尺寸(y=10.24)——
// 用错则弹射 gather 里 vis/sh0 采样 y 向拉伸 1.6%(patch.js EXT 同款课题,E.4 补修)
const vec3 VEXT = vec3(${(VOL.nx * VOL.cell).toFixed(3)}, ${(VOL.ny * VOL.cell).toFixed(3)}, ${(VOL.nz * VOL.cell).toFixed(3)});
float sat(float x) { return clamp(x, 0.0, 1.0); }
bool occAt(ivec3 c) {
  if (any(lessThan(c, ivec3(0))) || any(greaterThanEqual(c, N))) return false;
  uint w = texelFetch(uBits, ivec3(c.x >> 5, c.y, c.z), 0).r;
  return ((w >> uint(c.x & 31)) & 1u) == 1u;
}
// 解析房间界:墙 x/z=±12、地 y=0、顶 y=10——撞界距离(正向最近;界外/平行=大数)。
// 墙/顶/地不进位图(封闭壳会挡死一切):AO 用它补遮蔽,弹射用它给壳算辐射。
float wallT(vec3 o, vec3 d) {
  float t = 1e9;
  if (d.x > 1e-6) t = min(t, ( 12.0 - o.x) / d.x); else if (d.x < -1e-6) t = min(t, (-12.0 - o.x) / d.x);
  if (d.z > 1e-6) t = min(t, ( 12.0 - o.z) / d.z); else if (d.z < -1e-6) t = min(t, (-12.0 - o.z) / d.z);
  if (d.y > 1e-6) t = min(t, ( 10.0 - o.y) / d.y); else if (d.y < -1e-6) t = min(t, (  0.0 - o.y) / d.y);
  return max(t, 0.0);
}`;

// ---- pass① AO/天光 ----
const aoFsSrc = (rays) => `#version 300 es
precision highp float; precision highp int; precision highp usampler3D;
uniform usampler3D uBits;
uniform float uZ;                 // 当前探针层(z 索引)
uniform vec3 uDirs[${rays}];
uniform float uMaxT;              // AO 射线程(m)
layout(location=0) out vec4 o0;   // m0.rgb
layout(location=1) out vec4 o1;   // m1x.rgb
layout(location=2) out vec4 o2;   // m1y.rgb
layout(location=3) out vec4 o3;   // m1z.rgb
${COMMON}
// 1 = 射线在限程内畅通(天光可达),0 = 被位图/房间界挡(wallT 在 COMMON)
float trace(vec3 o, vec3 d) {
  float lim = min(uMaxT, wallT(o, d));
  vec3 p = (o - ORG) / CELL;
  ivec3 c = ivec3(floor(p));
  ivec3 stp = ivec3(sign(d));
  vec3 inv = 1.0 / max(abs(d), vec3(1e-8));
  vec3 frac = p - vec3(c);
  vec3 tMax = vec3(
    d.x > 0.0 ? (1.0 - frac.x) : frac.x,
    d.y > 0.0 ? (1.0 - frac.y) : frac.y,
    d.z > 0.0 ? (1.0 - frac.z) : frac.z
  ) * inv * CELL;
  vec3 tDelta = inv * CELL;
  float t = 0.0;
  for (int i = 0; i < 96; i++) {
    if (t >= lim) break;
    if (occAt(c)) return 0.0;
    if (tMax.x < tMax.y && tMax.x < tMax.z) { t = tMax.x; c.x += stp.x; tMax.x += tDelta.x; }
    else if (tMax.y < tMax.z)               { t = tMax.y; c.y += stp.y; tMax.y += tDelta.y; }
    else                                    { t = tMax.z; c.z += stp.z; tMax.z += tDelta.z; }
  }
  return lim < uMaxT ? 0.0 : 1.0;   // 限程内撞墙=挡;跑满程=开
}
void main() {
  ivec2 xy = ivec2(gl_FragCoord.xy);
  vec3 probe = ORG + (vec3(float(xy.x), float(xy.y), uZ) + 0.5) * VCELL;
  vec3 m0 = vec3(0.0), mx = vec3(0.0), my = vec3(0.0), mz = vec3(0.0);
  for (int i = 0; i < ${rays}; i++) {
    vec3 d = uDirs[i];
    float L = trace(probe, d);
    m0 += vec3(L);
    mx += vec3(L * d.x); my += vec3(L * d.y); mz += vec3(L * d.z);
  }
  float inv = 1.0 / float(${rays});
  o0 = vec4(m0 * inv, 1.0);
  o1 = vec4(mx * inv, 1.0);
  o2 = vec4(my * inv, 1.0);
  o3 = vec4(mz * inv, 1.0);
}`;

// ---- pass② 可见度(≤4 盏灯,RGBA 一通道一盏) ----
// 面光近似:向「灯位 + 单位球抖动 × 源半径」发 J 条影线,DDA 数通过率——半影随距离自然变宽。
// 影线两端各留余量:起点跳过自身格,终点提前 srcR+0.15m 停(光源常被自家灯具几何包着,
// 吊灯烛焰/炉火圆木都是占位体素,不留余量整间房全黑)。
const visFsSrc = (jitters) => `#version 300 es
precision highp float; precision highp int; precision highp usampler3D;
uniform usampler3D uBits;
uniform float uZ;
uniform vec3 uLPos[8];
uniform float uLSrcR[8];           // 源半径;<0 = 该槽无灯
uniform vec3 uJit[${jitters}];
layout(location=0) out vec4 o0;    // 灯 0..3
layout(location=1) out vec4 o1;    // 灯 4..7
${COMMON}
float shadowTrace(vec3 o, vec3 target, float stopEarly) {
  vec3 dv = target - o;
  float dist = length(dv);
  float lim = max(dist - stopEarly, 0.0);
  vec3 d = dv / max(dist, 1e-6);
  vec3 p = (o - ORG) / CELL;
  ivec3 c = ivec3(floor(p));
  ivec3 stp = ivec3(sign(d));
  vec3 inv = 1.0 / max(abs(d), vec3(1e-8));
  vec3 frac = p - vec3(c);
  vec3 tMax = vec3(
    d.x > 0.0 ? (1.0 - frac.x) : frac.x,
    d.y > 0.0 ? (1.0 - frac.y) : frac.y,
    d.z > 0.0 ? (1.0 - frac.z) : frac.z
  ) * inv * CELL;
  vec3 tDelta = inv * CELL;
  float t = 0.0;
  for (int i = 0; i < 512; i++) {
    if (t >= lim) break;
    if (t > 0.08 && occAt(c)) return 0.0;   // 起点 8cm 内不算(探针可能贴着自家几何)
    if (tMax.x < tMax.y && tMax.x < tMax.z) { t = tMax.x; c.x += stp.x; tMax.x += tDelta.x; }
    else if (tMax.y < tMax.z)               { t = tMax.y; c.y += stp.y; tMax.y += tDelta.y; }
    else                                    { t = tMax.z; c.z += stp.z; tMax.z += tDelta.z; }
  }
  return 1.0;
}
float visTo(vec3 probe, vec3 lp, float r) {
  // 抖动点翻到朝向探针的半球:全球面抖动时,远侧目标的影线会穿过灯具自身几何,
  // 连开阔地都只剩 ~5/8 可见度(全场被打暗 ~35%,实测)——发光面永远朝观察者
  vec3 toP = normalize(probe - lp);
  float acc = 0.0;
  for (int j = 0; j < ${jitters}; j++) {
    vec3 jd = uJit[j];
    if (dot(jd, toP) < 0.0) jd = -jd;
    acc += shadowTrace(probe, lp + jd * r, r + 0.15);
  }
  return acc / float(${jitters});
}
void main() {
  ivec2 xy = ivec2(gl_FragCoord.xy);
  vec3 probe = ORG + (vec3(float(xy.x), float(xy.y), uZ) + 0.5) * VCELL;
  float v[8];
  for (int i = 0; i < 8; i++) {
    v[i] = 0.0;
    // uniform 一致分支:空槽整个 warp 同路跳过,烘焙成本只随实际灯数涨
    if (uLSrcR[i] >= 0.0) v[i] = visTo(probe, uLPos[i], uLSrcR[i]);
  }
  o0 = vec4(v[0], v[1], v[2], v[3]);
  o1 = vec4(v[4], v[5], v[6], v[7]);
}`;

// ---- pass③ 弹射 gather(gen1 = 直射;prev=true 的 gen≥2 = 采上一代弹射场,E.2)----
// 每探针 N 条射线找最近表面(4m 内),入射辐射 = 反照率 × 命中面受光 → 有色 L1 矩:
//   gen1  受光 = Σ灯直射×可见度×0.5(平均余弦)+ 环境色×该点 AO + 太阳×dotNL
//   gen≥2 受光 = 上一代弹射场的 L1 辐照(m0 + 2·m1·n)——不重算直射,防双计
// 发光体素不在此发光(已聚成虚拟点光,否则双计)。
const bounceFsSrc = (rays, prev = false) => `#version 300 es
precision highp float; precision highp int; precision highp usampler3D; precision highp sampler3D;
uniform usampler3D uBits;
uniform sampler3D uAlb;            // 16cm 反照率 RGBA8(a=占位)
${prev ? `uniform sampler3D uPrev0, uPrev1, uPrev2, uPrev3;   // 上一代弹射 L1 矩(未乘 bounceK)` : `uniform sampler3D uVisT;           // 0.4m 可见度 RGBA(灯 0..3)
uniform sampler3D uVisT2;          // 灯 4..7(E.3)
uniform sampler3D uSh0T;           // 0.4m AO m0
uniform vec3 uLPos[8];
uniform vec3 uLColor[8];
uniform float uLK[8];              // 强度(未用槽=0)
uniform float uLDist[8];           // 衰减截断距离
uniform vec3 uAmb;                 // 环境色(线性,color×intensity)
uniform vec3 uSunDir;              // 主平行光方向(指向光源,单位化)
uniform vec3 uSunC;                // 主平行光 色×强度(线性);0 = 无`}
uniform float uZ;
uniform vec3 uDirs[${rays}];
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
layout(location=2) out vec4 o2;
layout(location=3) out vec4 o3;
${COMMON}
vec3 volUvw(vec3 w) { return (w - ORG) / VEXT; }
${prev ? `
// gen≥2 表面出射辐射:反照率 × 上一代弹射场辐照。采样点沿命中面法线抬半探针格
// (0.2m,与运行时 patch.js 同款偏移)——贴面探针可能落在实体内,是全黑
vec3 surfRadiance(vec3 hitW, vec3 albRgb, vec3 nrm) {
  vec3 uvw = volUvw(hitW + nrm * 0.2);
  vec3 E = texture(uPrev0, uvw).rgb
         + 2.0 * (texture(uPrev1, uvw).rgb * nrm.x + texture(uPrev2, uvw).rgb * nrm.y + texture(uPrev3, uvw).rgb * nrm.z);
  return albRgb * max(E, vec3(0.0));
}` : `
// E.4:太阳项影测——只测占位位图(家具/摆放物),**不测房间界**:月光是"漏进屋"的
// 氛围光,若测到墙则封闭房间里永远全黑;短程 3m 足够挡出桌下/椅下的弹射阴影
float sunOpen(vec3 o, vec3 d) {
  vec3 p = (o - ORG) / CELL;
  ivec3 c = ivec3(floor(p));
  ivec3 stp = ivec3(sign(d));
  vec3 inv = 1.0 / max(abs(d), vec3(1e-8));
  vec3 frac = p - vec3(c);
  vec3 tMax = vec3(
    d.x > 0.0 ? (1.0 - frac.x) : frac.x,
    d.y > 0.0 ? (1.0 - frac.y) : frac.y,
    d.z > 0.0 ? (1.0 - frac.z) : frac.z
  ) * inv * CELL;
  vec3 tDelta = inv * CELL;
  float t = 0.0;
  for (int i = 0; i < 80; i++) {
    if (t >= 3.0) break;
    if (t > 0.06 && occAt(c)) return 0.0;
    if (tMax.x < tMax.y && tMax.x < tMax.z) { t = tMax.x; c.x += stp.x; tMax.x += tDelta.x; }
    else if (tMax.y < tMax.z)               { t = tMax.y; c.y += stp.y; tMax.y += tDelta.y; }
    else                                    { t = tMax.z; c.z += stp.z; tMax.z += tDelta.z; }
  }
  return 1.0;
}
// 表面出射辐射(diffuse 假设):反照率 × [Σ灯直射×可见度×0.5 + 环境×AO + 太阳×dotNL×影]。
// 太阳(主平行光)必须参与弹射——它是亮墙/地板的主能量,不弹 GI 时墙角"一面亮一面死黑"
// (用户真机实测);影测是 E.4 增项(此前无影近似,桌下吃满月光弹射)。
vec3 surfRadiance(vec3 hitW, vec3 albRgb, vec3 nrm) {
  vec3 uvw = volUvw(hitW);
  vec4 vA = texture(uVisT, uvw);
  vec4 vB = texture(uVisT2, uvw);
  float vis[8];
  vis[0] = vA.x; vis[1] = vA.y; vis[2] = vA.z; vis[3] = vA.w;
  vis[4] = vB.x; vis[5] = vB.y; vis[6] = vB.z; vis[7] = vB.w;
  vec3 E = uAmb * texture(uSh0T, uvw).r;
  float sdnl = sat(dot(nrm, uSunDir));
  if (dot(uSunC, uSunC) > 0.0 && sdnl > 0.0) E += uSunC * (sdnl * sunOpen(hitW, uSunDir));
  for (int l = 0; l < 8; l++) {
    if (uLK[l] == 0.0) continue;   // 空槽 uniform 分支跳过
    vec3 lv = uLPos[l] - hitW;
    float dl = max(length(lv), 0.02);
    float fall = 1.0 / max(dl * dl, 0.01);
    float k4 = dl / uLDist[l]; k4 *= k4; k4 *= k4;
    float cut = sat(1.0 - k4); cut *= cut;
    E += uLColor[l] * (uLK[l] * fall * cut * vis[l] * 0.5);
  }
  return albRgb * E;
}`}
// 房间壳反照率(线性;壳不进反照率体,近似取酒馆基调色——地板木、混合墙面、深木顶)。
// 取值按真实材质 sRGB 换算(地板 ~sRGB150/110/75,墙 ~120/100/85):首版取保守暗值,
// 弹回的光只有一半,墙角过渡仍显生硬(用户第五轮反馈)
const vec3 SHELL_FLOOR = vec3(0.30, 0.16, 0.075);
const vec3 SHELL_WALL  = vec3(0.19, 0.13, 0.095);
const vec3 SHELL_CEIL  = vec3(0.10, 0.06, 0.04);
// 命中最近表面 → 出射辐射。位图内未命中但限程内撞房间壳 → 壳辐射:
// 「灯→地板→反弹向上」是室内 GI 的主导项,壳返回 0 会把弹射砍掉大半(对抗审计确认项)。
vec3 hitRadiance(vec3 o, vec3 d) {
  float lim = min(4.0, wallT(o, d));
  vec3 p = (o - ORG) / CELL;
  ivec3 c = ivec3(floor(p));
  ivec3 stp = ivec3(sign(d));
  vec3 inv = 1.0 / max(abs(d), vec3(1e-8));
  vec3 frac = p - vec3(c);
  vec3 tMax = vec3(
    d.x > 0.0 ? (1.0 - frac.x) : frac.x,
    d.y > 0.0 ? (1.0 - frac.y) : frac.y,
    d.z > 0.0 ? (1.0 - frac.z) : frac.z
  ) * inv * CELL;
  vec3 tDelta = inv * CELL;
  float t = 0.0;
  for (int i = 0; i < 128; i++) {
    if (t >= lim) break;
    if (t > 0.06 && occAt(c)) {
      vec3 hitW = ORG + (vec3(c) + 0.5) * CELL;
      vec4 alb = texture(uAlb, volUvw(hitW));
      if (alb.a < 0.1) return vec3(0.0);
      return surfRadiance(hitW, alb.rgb, -d);   // 体素命中无法线,取入射反向作漫射伪法线
    }
    if (tMax.x < tMax.y && tMax.x < tMax.z) { t = tMax.x; c.x += stp.x; tMax.x += tDelta.x; }
    else if (tMax.y < tMax.z)               { t = tMax.y; c.y += stp.y; tMax.y += tDelta.y; }
    else                                    { t = tMax.z; c.z += stp.z; tMax.z += tDelta.z; }
  }
  if (lim < 4.0) {
    vec3 hitW = o + d * (lim - 0.02);
    // 壳法线精确可知:地朝上/顶朝下/墙朝房内
    vec3 shell; vec3 nrm;
    if (hitW.y < 0.05)      { shell = SHELL_FLOOR; nrm = vec3(0.0, 1.0, 0.0); }
    else if (hitW.y > 9.9)  { shell = SHELL_CEIL;  nrm = vec3(0.0, -1.0, 0.0); }
    else if (abs(hitW.x) > 11.9) { shell = SHELL_WALL; nrm = vec3(-sign(hitW.x), 0.0, 0.0); }
    else                    { shell = SHELL_WALL; nrm = vec3(0.0, 0.0, -sign(hitW.z)); }
    return surfRadiance(hitW, shell, nrm);
  }
  return vec3(0.0);
}
void main() {
  ivec2 xy = ivec2(gl_FragCoord.xy);
  vec3 probe = ORG + (vec3(float(xy.x), float(xy.y), uZ) + 0.5) * VCELL;
  vec3 m0 = vec3(0.0), mx = vec3(0.0), my = vec3(0.0), mz = vec3(0.0);
  for (int i = 0; i < ${rays}; i++) {
    vec3 d = uDirs[i];
    vec3 L = hitRadiance(probe, d);
    m0 += L; mx += L * d.x; my += L * d.y; mz += L * d.z;
  }
  float inv = 1.0 / float(${rays});
  o0 = vec4(m0 * inv, 1.0);
  o1 = vec4(mx * inv, 1.0);
  o2 = vec4(my * inv, 1.0);
  o3 = vec4(mz * inv, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`烘焙 shader 编译失败: ${log}`);
  }
  return s;
}
function link(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`烘焙 program 链接失败: ${log}`);
  }
  return p;
}

/**
 * buildLightVolume(renderer, domain, opts) → vol | null(WebGL2/扩展缺失/烘焙失败)
 * opts:
 *   rays        AO/弹射射线数(默认 64;headless SwiftShader 用 ?voxrays= 降载)
 *   maxT        AO 限程(默认 2.5m)
 *   lights      ≤8 盏(E.3):{pos:[x,y,z], srcR, color:[r,g,b] 线性, k, dist}(真实灯在前,虚拟灯在后)
 *   ambient     [r,g,b] 环境色(线性,color×intensity)——烘焙期折入 SH,运行时不再乘
 *   bounce      默认 true;false = 只烘 AO(调试用)
 *   bounces     弹射代数(默认 2,钳 1~4;每多一代 volMs 约 +1×pass③)
 *   bounceK     弹射项整体艺术增益(默认 1.4;=1 关掉,验收对比用;详见 pass③ 注释)
 * vol: {shA/shB/shC(SH 三张打包,已折环境色+弹射;布局见返回处), vis, vis2, ms, bounces, sampleM0, sampleVis, dispose}
 */
export function getVoxelLightSupport(renderer) {
  if (!renderer?.getContext) return { supported: false, reason: 'renderer-unavailable' };
  let gl;
  try { gl = renderer.getContext(); }
  catch { return { supported: false, reason: 'context-unavailable' }; }
  if (!gl || gl.isContextLost?.()) return { supported: false, reason: 'context-lost' };
  // capabilities.isWebGL2 比跨 realm instanceof 稳定；后者作旧 three/测试桩回退。
  const webgl2 = renderer.capabilities?.isWebGL2
    ?? (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext);
  if (!webgl2) return { supported: false, reason: 'webgl2-required' };
  if (!gl.getExtension('EXT_color_buffer_float')) return { supported: false, reason: 'ext-color-buffer-float-required' };
  return { supported: true, reason: null };
}

export function buildLightVolume(renderer, domain, opts = {}) {
  const t0 = performance.now();
  const gl = renderer.getContext();
  if (!getVoxelLightSupport(renderer).supported) return null;

  const maxT = opts.maxT ?? 2.5;
  const rays = opts.rays ?? RAYS_DEFAULT;
  const lights = (opts.lights ?? []).slice(0, 8);
  const ambient = opts.ambient ?? [0, 0, 0];
  // 主平行光(弹射用):{dir:[x,y,z] 指向光源, color:[r,g,b] 线性×强度};缺省 = 不参与
  const sun = opts.sun ?? null;
  const doBounce = opts.bounce ?? true;

  // GL 资源登记(纹理/FBO/program):清理统一走 finally——shader 编译失败等异常路径上,
  // 已建的 bitsTex(13.1MB)/反照率体等否则每次重烘泄漏一轮,连续摆放几十次即耗尽显存
  // (对抗审计确认项;WebGL 对已删除对象的重复 delete 是无害 no-op,快乐路径不再单独清)
  const glTex = [], glFbo = [], glProg = [];

  // 任何一步抛异常(shader 编译失败等)都必须 resetState 交还 three,
  // 否则脏 GL 状态(FBO/纹理槽/pixelStorei)会把整个渲染器打死(实测教训)
  try {
    return buildInner();
  } catch (e) {
    console.warn('[voxlight] 光照体积烘焙失败,退回无体积', e);
    return null;
  } finally {
    for (const t of glTex) gl.deleteTexture(t);
    for (const f of glFbo) gl.deleteFramebuffer(f);
    for (const p of glProg) gl.deleteProgram(p);
    renderer.resetState();
  }

  function buildInner() {
    const probeN = VOL.nx * VOL.ny * VOL.nz;
    const layerPix = new Float32Array(VOL.nx * VOL.ny * 4);
    const toHalf = THREE.DataUtils.toHalfFloat;

    // ---- 共享 GL 资源 ----
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    // three 的上传路径会残留 FLIP_Y/PREMULTIPLY 状态——3D 纹理禁止这两项,必须显式关掉
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const tex3d = (unit, internal, w, h, d, format, type, data, filter) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_3D, t);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
      gl.texImage3D(gl.TEXTURE_3D, 0, internal, w, h, d, 0, format, type, data);
      glTex.push(t);
      return t;
    };
    tex3d(0, gl.R32UI, DOMAIN.wordsX, DOMAIN.ny, DOMAIN.nz, gl.RED_INTEGER, gl.UNSIGNED_INT, domain.bits, gl.NEAREST);

    // MRT×4 RGBA32F 小 FBO(pass①③ 共用)+ 单附件 FBO(pass②)
    const fbo4 = gl.createFramebuffer();
    glFbo.push(fbo4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo4);
    for (let i = 0; i < 4; i++) {
      const t = gl.createTexture();
      glTex.push(t);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, VOL.nx, VOL.ny, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
    }
    gl.viewport(0, 0, VOL.nx, VOL.ny);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    // 逐层渲 MRT×n → 回读进 Float32Array[n](每元素 probeN*4)
    const renderPasses = (prog, nOut, setLayerUniform) => {
      gl.useProgram(prog);
      const outF = [];
      for (let a = 0; a < nOut; a++) outF.push(new Float32Array(probeN * 4));
      const bufs = [];
      for (let a = 0; a < nOut; a++) bufs.push(gl.COLOR_ATTACHMENT0 + a);
      gl.drawBuffers(bufs);
      for (let z = 0; z < VOL.nz; z++) {
        setLayerUniform(z);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        for (let a = 0; a < nOut; a++) {
          gl.readBuffer(gl.COLOR_ATTACHMENT0 + a);
          gl.readPixels(0, 0, VOL.nx, VOL.ny, gl.RGBA, gl.FLOAT, layerPix);
          outF[a].set(layerPix, z * VOL.nx * VOL.ny * 4);
        }
      }
      return outF;
    };

    // ---- pass① AO ----
    const aoProg = link(gl, aoFsSrc(rays));
    glProg.push(aoProg);
    gl.useProgram(aoProg);
    gl.uniform1i(gl.getUniformLocation(aoProg, 'uBits'), 0);
    gl.uniform1f(gl.getUniformLocation(aoProg, 'uMaxT'), maxT);
    gl.uniform3fv(gl.getUniformLocation(aoProg, 'uDirs[0]'), fibDirs(rays));
    const aoUZ = gl.getUniformLocation(aoProg, 'uZ');
    const aoF = renderPasses(aoProg, 4, (z) => gl.uniform1f(aoUZ, z));
    gl.deleteProgram(aoProg);

    // ---- pass② 可见度(≤8 盏,两张 RGBA;E.3) ----
    let visF = null, visF2 = null;
    if (lights.length) {
      const jitters = opts.shadowRays ?? Math.max(8, Math.round(rays / 4));
      const visProg = link(gl, visFsSrc(jitters));
      glProg.push(visProg);
      gl.useProgram(visProg);
      gl.uniform1i(gl.getUniformLocation(visProg, 'uBits'), 0);
      gl.uniform3fv(gl.getUniformLocation(visProg, 'uJit[0]'), fibDirs(jitters));
      const pos = new Float32Array(24);
      const srcR = new Float32Array(8).fill(-1);
      lights.forEach((l, i) => { pos.set(l.pos, i * 3); srcR[i] = l.srcR ?? 0.3; });
      gl.uniform3fv(gl.getUniformLocation(visProg, 'uLPos[0]'), pos);
      gl.uniform1fv(gl.getUniformLocation(visProg, 'uLSrcR[0]'), srcR);
      const visUZ = gl.getUniformLocation(visProg, 'uZ');
      [visF, visF2] = renderPasses(visProg, 2, (z) => gl.uniform1f(visUZ, z));
      gl.deleteProgram(visProg);
    }

    // ---- pass③ 弹射(E.2:迭代 gather,默认 2 代) ----
    // bounceK 的真实身份(E.2 实测后改判):**整个弹射项的艺术增益**,不是级数截断补偿——
    // 本场景实测逐代能量比 ρ≈0.04(暗色调酒馆,壳反照率 0.1~0.3),理论截断尾巴只有
    // ~1.04,而 v1 标定的 1.4 是把弹射项整体抬亮的观感旋钮。所以 K 乘在累加后的总和上:
    // 曾试过"只乘末代"的级数补偿式——结果 2 代总量 ≈ E1+1.4·0.04·E1 ≈ 1.06·E1,
    // 比 v1 的 1.4·E1 反而暗 25%,把上一轮标定好的墙角柔和过渡整个回退掉(数值探针实测)。
    // 现式:总弹射 = K·(E1+E2+…)——bounces=1 恒等于 v1,加代数只会单调变亮,零回退。
    const bounces = Math.max(1, Math.min(4, Math.round(opts.bounces ?? 2)));
    const bounceK = opts.bounceK ?? 1.4;
    let bounceF = null;
    if (doBounce && visF) {
      const halfOf = (f32) => {
        const h = new Uint16Array(f32.length);
        for (let i = 0; i < f32.length; i++) h[i] = toHalf(f32[i]);
        return h;
      };
      // SRGB8_ALPHA8:反照率体是 sRGB 字节(bake/brick 累加口径),采样时硬件解码回线性——
      // 用 RGBA8 直接当线性乘会让弹射平均偏亮 ~2× 且 color bleeding 发灰(对抗审计确认项)
      tex3d(1, gl.SRGB8_ALPHA8, DOMAIN.anx, DOMAIN.any, DOMAIN.anz, gl.RGBA, gl.UNSIGNED_BYTE, domain.albedo, gl.LINEAR);
      tex3d(2, gl.RGBA16F, VOL.nx, VOL.ny, VOL.nz, gl.RGBA, gl.HALF_FLOAT, halfOf(visF), gl.LINEAR);
      tex3d(3, gl.RGBA16F, VOL.nx, VOL.ny, VOL.nz, gl.RGBA, gl.HALF_FLOAT, halfOf(aoF[0]), gl.LINEAR);
      // 单元 4..7 留给 E.2 的上一代弹射矩,vis 第二张(灯 4..7)排 8
      tex3d(8, gl.RGBA16F, VOL.nx, VOL.ny, VOL.nz, gl.RGBA, gl.HALF_FLOAT, halfOf(visF2), gl.LINEAR);
      const bProg = link(gl, bounceFsSrc(rays));
      glProg.push(bProg);
      gl.useProgram(bProg);
      gl.uniform1i(gl.getUniformLocation(bProg, 'uBits'), 0);
      gl.uniform1i(gl.getUniformLocation(bProg, 'uAlb'), 1);
      gl.uniform1i(gl.getUniformLocation(bProg, 'uVisT'), 2);
      gl.uniform1i(gl.getUniformLocation(bProg, 'uVisT2'), 8);
      gl.uniform1i(gl.getUniformLocation(bProg, 'uSh0T'), 3);
      gl.uniform3fv(gl.getUniformLocation(bProg, 'uDirs[0]'), fibDirs(rays));
      gl.uniform3fv(gl.getUniformLocation(bProg, 'uAmb'), ambient);
      const sd = sun ? [...sun.dir] : [0, 1, 0];
      const sl = Math.hypot(...sd) || 1;
      gl.uniform3fv(gl.getUniformLocation(bProg, 'uSunDir'), sd.map((v) => v / sl));
      gl.uniform3fv(gl.getUniformLocation(bProg, 'uSunC'), sun?.color ?? [0, 0, 0]);
      const pos = new Float32Array(24), col = new Float32Array(24);
      const kk = new Float32Array(8), dd = new Float32Array(8).fill(1);
      lights.forEach((l, i) => {
        pos.set(l.pos, i * 3);
        col.set(l.color ?? [0, 0, 0], i * 3);
        kk[i] = l.k ?? 0;
        dd[i] = l.dist ?? 1;
      });
      gl.uniform3fv(gl.getUniformLocation(bProg, 'uLPos[0]'), pos);
      gl.uniform3fv(gl.getUniformLocation(bProg, 'uLColor[0]'), col);
      gl.uniform1fv(gl.getUniformLocation(bProg, 'uLK[0]'), kk);
      gl.uniform1fv(gl.getUniformLocation(bProg, 'uLDist[0]'), dd);
      const bUZ = gl.getUniformLocation(bProg, 'uZ');
      gl.activeTexture(gl.TEXTURE0);   // 回到位图槽(renderPasses 用 program 已设好采样槽)
      let prevF = renderPasses(bProg, 4, (z) => gl.uniform1f(bUZ, z));
      gl.deleteProgram(bProg);
      // gen≥2:上一代 4 张矩上传为 3D 纹理 → 同一套射线 gather 上一代场;逐代累加。
      // 累加器直接复用 gen1 数组(上传纹理在前,之后改 CPU 侧无影响);coeff 见上 bounceK 注释
      const acc = prevF;
      for (let g = 2; g <= bounces; g++) {
        for (let a = 0; a < 4; a++) {
          tex3d(4 + a, gl.RGBA16F, VOL.nx, VOL.ny, VOL.nz, gl.RGBA, gl.HALF_FLOAT, halfOf(prevF[a]), gl.LINEAR);
        }
        const p2 = link(gl, bounceFsSrc(rays, true));
        glProg.push(p2);
        gl.useProgram(p2);
        gl.uniform1i(gl.getUniformLocation(p2, 'uBits'), 0);
        gl.uniform1i(gl.getUniformLocation(p2, 'uAlb'), 1);
        for (let a = 0; a < 4; a++) gl.uniform1i(gl.getUniformLocation(p2, `uPrev${a}`), 4 + a);
        gl.uniform3fv(gl.getUniformLocation(p2, 'uDirs[0]'), fibDirs(rays));
        const z2 = gl.getUniformLocation(p2, 'uZ');
        gl.activeTexture(gl.TEXTURE0);
        const genF = renderPasses(p2, 4, (z) => gl.uniform1f(z2, z));
        gl.deleteProgram(p2);
        for (let a = 0; a < 4; a++) {
          const A = acc[a], G = genF[a];
          for (let i = 0; i < A.length; i++) A[i] += G[i];
        }
        prevF = genF;   // 下一代 gather 的场 = 本代(原始输出,不含 K)
      }
      // 艺术增益乘总和(见上注释;必须在所有代 gather 完之后——gather 采的是原始场)
      for (let a = 0; a < 4; a++) {
        const A = acc[a];
        for (let i = 0; i < A.length; i++) A[i] *= bounceK;
      }
      bounceF = acc;
    }

    // ---- 合成:SH = (AO 保底后的)AO矩 × 环境色 + 弹射矩(环境色烘焙期折入) ----
    // AO 保底(aoFloor):环境项是封闭酒馆唯一的底光,AO 压到 0 = 墙角/远墙死黑
    // (用户真机实测两面墙全黑)。只垫环境份额:m0' = floor + (1-floor)·m0,
    // m1' = (1-floor)·m1(方向矩同缩,保证 E(n) ≥ floor);弹射项不动。
    const aoFloor = Math.min(1, Math.max(0, opts.aoFloor ?? 0.35));
    const aoK = 1 - aoFloor;
    // 弹射项 bounceF 已含逐代累加与末代 bounceK 截断补偿(pass③ 处折入),此处直接相加
    const finalHalf = [];
    for (let a = 0; a < 4; a++) {
      const h = new Uint16Array(probeN * 4);
      const ao = aoF[a], bo = bounceF?.[a];
      const base = a === 0 ? aoFloor : 0;
      for (let i = 0; i < probeN; i++) {
        const o = i * 4;
        h[o] = toHalf((base + aoK * ao[o]) * ambient[0] + (bo ? bo[o] : 0));
        h[o + 1] = toHalf((base + aoK * ao[o + 1]) * ambient[1] + (bo ? bo[o + 1] : 0));
        h[o + 2] = toHalf((base + aoK * ao[o + 2]) * ambient[2] + (bo ? bo[o + 2] : 0));
        h[o + 3] = toHalf(1);
      }
      finalHalf.push(h);
    }
    const halfCopy = (f32) => {
      const h = new Uint16Array(probeN * 4);
      for (let i = 0; i < h.length; i++) h[i] = toHalf(f32[i]);
      return h;
    };
    const visHalf = visF ? halfCopy(visF) : null;
    const visHalf2 = visF2 ? halfCopy(visF2) : null;

    // CPU 副本(数值探针)
    const m0Float = new Float32Array(probeN);
    for (let i = 0; i < probeN; i++) m0Float[i] = aoF[0][i * 4];
    // 最终 SH m0(环境+弹射合成后)与纯弹射 m0 的 RGB 副本——E.2 验收要能量化
    // "多一代弹射加了多少",屏幕 8-bit 量化在暗部看不出 <1 count 的差
    const shFloat = new Float32Array(probeN * 3);
    const boFloat = bounceF ? new Float32Array(probeN * 3) : null;
    for (let i = 0; i < probeN; i++) {
      const o = i * 4, ao = aoF[0], bo = bounceF?.[0];
      const base = aoFloor;
      for (let ch = 0; ch < 3; ch++) {
        shFloat[i * 3 + ch] = (base + aoK * ao[o + ch]) * ambient[ch] + (bo ? bo[o + ch] : 0);
        if (boFloat) boFloat[i * 3 + ch] = bo[o + ch];
      }
    }

    // ---- 清理 GL 手工态,交还 three(finally 里还有一次 resetState 兜底) ----

    const mkTex = (data) => {
      const t = new THREE.Data3DTexture(data, VOL.nx, VOL.ny, VOL.nz);
      t.format = THREE.RGBAFormat;
      t.type = THREE.HalfFloatType;
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    };
    const probeIdx = (wx, wy, wz) => {
      const ix = Math.min(VOL.nx - 1, Math.max(0, Math.round((wx - DOMAIN.origin[0]) / VOL.cell - 0.5)));
      const iy = Math.min(VOL.ny - 1, Math.max(0, Math.round((wy - DOMAIN.origin[1]) / VOL.cell - 0.5)));
      const iz = Math.min(VOL.nz - 1, Math.max(0, Math.round((wz - DOMAIN.origin[2]) / VOL.cell - 0.5)));
      return ix + VOL.nx * (iy + VOL.ny * iz);
    };
    return {
      // SH 三张打包(E.5,少一次逐片元采样;逐通道值不变):A=m0.rgb+mx.r / B=mx.gb+my.rg / C=my.b+mz.rgb
      ...(() => {
        const p = [new Uint16Array(probeN * 4), new Uint16Array(probeN * 4), new Uint16Array(probeN * 4)];
        const [m0, mx, my, mz] = finalHalf;
        for (let i = 0; i < probeN; i++) {
          const o = i * 4;
          p[0][o] = m0[o]; p[0][o + 1] = m0[o + 1]; p[0][o + 2] = m0[o + 2]; p[0][o + 3] = mx[o];
          p[1][o] = mx[o + 1]; p[1][o + 1] = mx[o + 2]; p[1][o + 2] = my[o]; p[1][o + 3] = my[o + 1];
          p[2][o] = my[o + 2]; p[2][o + 1] = mz[o]; p[2][o + 2] = mz[o + 1]; p[2][o + 3] = mz[o + 2];
        }
        return { shA: mkTex(p[0]), shB: mkTex(p[1]), shC: mkTex(p[2]) };
      })(),
      vis: visHalf ? mkTex(visHalf) : null,     // RGBA = 灯 0..3 可见度
      vis2: visHalf2 ? mkTex(visHalf2) : null,  // RGBA = 灯 4..7(E.3)
      ms: Math.round(performance.now() - t0),
      bounces: doBounce && visF ? bounces : 0,   // 实际跑的弹射代数(探针/E2E 断言用)
      // 数值探针(验收/E2E):世界坐标 → 最近探针
      sampleM0(wx, wy, wz) { return m0Float[probeIdx(wx, wy, wz)]; },          // AO 开阔度(未折色)
      sampleVis(wx, wy, wz) {   // 8 槽:0..3 主纹理,4..7 第二张(E.3)
        if (!visF) return null;
        const i = probeIdx(wx, wy, wz) * 4;
        return [
          visF[i], visF[i + 1], visF[i + 2], visF[i + 3],
          visF2[i], visF2[i + 1], visF2[i + 2], visF2[i + 3],
        ];
      },
      sampleSh0(wx, wy, wz) {          // 最终 SH m0 RGB(环境+弹射合成后,线性)
        const i = probeIdx(wx, wy, wz) * 3;
        return [shFloat[i], shFloat[i + 1], shFloat[i + 2]];
      },
      sampleBounce0(wx, wy, wz) {      // 纯弹射 m0 RGB(已含逐代累加+末代补偿)
        if (!boFloat) return null;
        const i = probeIdx(wx, wy, wz) * 3;
        return [boFloat[i], boFloat[i + 1], boFloat[i + 2]];
      },
      dispose() { this.shA.dispose(); this.shB.dispose(); this.shC.dispose(); this.vis?.dispose(); this.vis2?.dispose(); },
    };
  }
}
