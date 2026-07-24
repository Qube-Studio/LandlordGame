// MagicaVoxel .vox 读写(从零实现,docs/VOXEL_PLAN.md P0)。纯 typed-array,零依赖——
// 浏览器(voxload)与 node 工具(voxgen/voxtest)共用同一份。
// 坐标约定:.vox 是 z-up 右手系,three 是 y-up。互转规则(写死,勿改——已建资产依赖它):
//   three(x, y, z)  ⇔  vox(x, sizeThreeZ-1-z, y)
// 即 three 的 y 对应 vox 的 z(高度),three 的 z 沿 vox 的 y 反向。roundtrip 单测保证恒等。
// 调色板约定(MagicaVoxel 官方怪癖):体素存的索引 i ∈ 1..255,颜色在 RGBA 块的第 (i-1) 组
// 4 字节;索引 0 = 空。palette 参数统一用 256×4 的 Uint8Array,palette[(i-1)*4..] = RGBA。
//
// 2026-07-16 扩展(props 素材批次,VOXEL_PLAN 附录 C):
// - MATL 材质块:writeVox 第三参 { materials: { [索引]: { _type, ... } } } 逐索引写出
//   (发光 _emit / 金属 _metal / 玻璃 _glass);parseVox 返回 materials(键=索引,值=字符串字典)。
//   运行时 voxload 仍按 hex 拆自发光子网格,MATL 面向 MagicaVoxel 手修与将来的渲染升级。
// - 多模型分块:任一轴 > 256 时自动切成 ≤256 的块,写 nTRN/nGRP/nSHP 场景图
//   (MagicaVoxel 大模型的官方形态);parseVox 沿场景图平移拼回单个 dense(只支持 _t,含 _r 即抛错)。
//   块长凑偶数 → 模型枢轴 floor(size/2) 无奇偶歧义(MagicaVoxel 打开无接缝);
//   因此超 256 的资产总尺寸请取偶数(生成器侧保证)。
// 单模型 + 无材质路径的输出与旧版逐字节一致(已建 chandelier-deluxe.vox 不漂移)。

const enc = (s) => [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)];

// 稠密体(three y-up 口径):{ sx, sy, sz, data: Uint8Array(sx*sy*sz) },index = x + sx*(y + sy*z),值=调色板索引(0 空)
export function makeDense(sx, sy, sz) {
  return { sx, sy, sz, data: new Uint8Array(sx * sy * sz) };
}
export const dIdx = (v, x, y, z) => x + v.sx * (y + v.sy * z);

// ---- 小字节写手(chunk 内容拼装用;.vox 字符串是 ASCII) ----
class BW {
  constructor() { this.parts = []; this.size = 0; }
  u8a(arr) { this.parts.push(arr); this.size += arr.length; }
  i32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, true); this.u8a(b); }
  str(s) {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
    this.i32(b.length); this.u8a(b);
  }
  dict(obj) {
    const ks = Object.keys(obj);
    this.i32(ks.length);
    for (const k of ks) { this.str(k); this.str(String(obj[k])); }
  }
  out() {
    const o = new Uint8Array(this.size);
    let p = 0;
    for (const a of this.parts) { o.set(a, p); p += a.length; }
    return o;
  }
}
function chunkBytes(id, content) {
  const b = new Uint8Array(12 + content.length);
  const c = enc(id);
  b[0] = c[0]; b[1] = c[1]; b[2] = c[2]; b[3] = c[3];
  const dv = new DataView(b.buffer);
  dv.setInt32(4, content.length, true);
  dv.setInt32(8, 0, true);
  b.set(content, 12);
  return b;
}

// 轴向分块:>256 时切成 ≤256 的段;段长凑偶数(枢轴 floor(size/2) 无歧义),总长为偶时全段皆偶
function splitAxis(n) {
  if (n <= 256) return [n];
  const parts = Math.ceil(n / 256);
  let base = Math.ceil(n / parts);
  if (base & 1) base++;
  const sizes = [];
  let rest = n;
  for (let i = 0; i < parts - 1; i++) { sizes.push(base); rest -= base; }
  if (rest <= 0 || rest > 256) throw new Error(`vox 分块失败: n=${n}`);
  sizes.push(rest);
  return sizes;
}

// 全体切块(three 口径);全空的块丢弃(MagicaVoxel 不需要空模型)
function tileDense(dense) {
  const { sx, sy, sz, data } = dense;
  if (sx <= 256 && sy <= 256 && sz <= 256) return [{ dense, x0: 0, y0: 0, z0: 0 }];
  const tiles = [];
  let z0 = 0;
  for (const nz of splitAxis(sz)) {
    let y0 = 0;
    for (const ny of splitAxis(sy)) {
      let x0 = 0;
      for (const nx of splitAxis(sx)) {
        const t = makeDense(nx, ny, nz);
        let any = false;
        for (let z = 0; z < nz; z++) {
          for (let y = 0; y < ny; y++) {
            for (let x = 0; x < nx; x++) {
              const v = data[(x0 + x) + sx * ((y0 + y) + sy * (z0 + z))];
              if (v) { t.data[x + nx * (y + ny * z)] = v; any = true; }
            }
          }
        }
        if (any) tiles.push({ dense: t, x0, y0, z0 });
        x0 += nx;
      }
      y0 += ny;
    }
    z0 += nz;
  }
  return tiles;
}

// 写 .vox:dense(y-up) + palette(256×4 RGBA) [+ opts.materials] → ArrayBuffer
export function writeVox(dense, palette, opts = {}) {
  const tiles = tileDense(dense);
  const chunks = [];
  for (const m of tiles) {
    const { sx, sy, sz, data } = m.dense;
    const sw = new BW();
    sw.i32(sx); sw.i32(sz); sw.i32(sy); // vox SIZE 是 (x, y, z) z-up:x=sx, y=szThree, z=syThree
    chunks.push(chunkBytes('SIZE', sw.out()));
    const vox = [];
    for (let z = 0; z < sz; z++) {
      for (let y = 0; y < sy; y++) {
        for (let x = 0; x < sx; x++) {
          const i = data[x + sx * (y + sy * z)];
          if (i) vox.push(x, sz - 1 - z, y, i); // three→vox: (x, szThree-1-z, y)
        }
      }
    }
    const xw = new BW();
    xw.i32(vox.length / 4);
    const arr = new Uint8Array(vox.length);
    arr.set(vox);
    xw.u8a(arr);
    chunks.push(chunkBytes('XYZI', xw.out()));
  }
  if (tiles.length > 1) {
    // 场景图:root nTRN(0) → nGRP(1) → 每块 nTRN(2+2k)→nSHP(3+2k)。_t=块中心(全局居中)
    const trn = (id, childId, t) => {
      const w = new BW();
      w.i32(id); w.dict({}); w.i32(childId); w.i32(-1); w.i32(0); w.i32(1);
      w.dict(t ? { _t: `${t[0]} ${t[1]} ${t[2]}` } : {});
      return chunkBytes('nTRN', w.out());
    };
    chunks.push(trn(0, 1, null));
    const gw = new BW();
    gw.i32(1); gw.dict({}); gw.i32(tiles.length);
    for (let k = 0; k < tiles.length; k++) gw.i32(2 + 2 * k);
    chunks.push(chunkBytes('nGRP', gw.out()));
    const cX = dense.sx >> 1, cY = dense.sz >> 1, cZ = dense.sy >> 1; // 全局 vox 轴中心
    tiles.forEach((m, k) => {
      const { sx: nx, sy: ny, sz: nz } = m.dense;
      // three 块 min → vox 块 min:(x0, szThree-(z0+nz), y0);_t 指向块中心(枢轴 floor(size/2))
      const t = [
        m.x0 + (nx >> 1) - cX,
        (dense.sz - (m.z0 + nz)) + (nz >> 1) - cY,
        m.y0 + (ny >> 1) - cZ,
      ];
      chunks.push(trn(2 + 2 * k, 3 + 2 * k, t));
      const sw = new BW();
      sw.i32(3 + 2 * k); sw.dict({}); sw.i32(1); sw.i32(k); sw.dict({});
      chunks.push(chunkBytes('nSHP', sw.out()));
    });
  }
  chunks.push(chunkBytes('RGBA', palette.subarray(0, 1024)));
  if (opts.materials) {
    const ids = Object.keys(opts.materials).map(Number).sort((a, b) => a - b);
    for (const id of ids) {
      const mw = new BW();
      mw.i32(id);
      mw.dict(opts.materials[id]);
      chunks.push(chunkBytes('MATL', mw.out()));
    }
  }
  const childBytes = chunks.reduce((s, c) => s + c.length, 0);
  const buf = new ArrayBuffer(8 + 12 + childBytes);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let p = 0;
  const tag = (s) => { u8.set(enc(s), p); p += 4; };
  const i32 = (v) => { dv.setInt32(p, v, true); p += 4; };
  tag('VOX '); i32(150);
  tag('MAIN'); i32(0); i32(childBytes);
  for (const c of chunks) { u8.set(c, p); p += c.length; }
  return buf;
}

// 归一化一条 MATL 记录：运行时的贪心分桶、材质和光照烘焙统一消费这一口径；
// matlRaw 继续保留原始字典给往返工具校验。
export function normalizeMatl(dict) {
  const f = (k, d) => {
    const v = parseFloat(dict[k]);
    return Number.isFinite(v) ? v : d;
  };
  const type = dict._type ?? '_diffuse';
  const rough = Math.min(1, Math.max(0, f('_rough', 1)));
  const metal = type === '_metal' ? Math.min(1, Math.max(0, f('_metal', f('_weight', 1)))) : 0;
  const emitK = type === '_emit'
    ? Math.min(8, Math.max(0, f('_emit', f('_weight', 1)) * Math.pow(2, f('_flux', 1) - 1)))
    : 0;
  const alpha = type === '_glass' ? Math.min(1, Math.max(0.05, 1 - f('_alpha', f('_trans', 0.5)))) : 1;
  return { type, rough, metal, emitK, alpha };
}

// 解析 .vox → { dense(y-up), palette(256×4), materials, matlRaw }。多模型沿场景图 _t 拼合;
// 不认识的块跳过(手修安全);场景图含旋转 _r 抛错(本项目不产,拼合语义未定义)。
// materials = Array(256) 归一化记录；matlRaw = 原始字符串字典。
export function parseVox(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const tagAt = (p) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
  if (tagAt(0) !== 'VOX ') throw new Error('不是 .vox 文件');
  const readStr = (pos) => {
    const n = dv.getInt32(pos, true);
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(u8[pos + 4 + i]);
    return { s, next: pos + 4 + n };
  };
  const readDict = (pos) => {
    const n = dv.getInt32(pos, true);
    pos += 4;
    const d = {};
    for (let i = 0; i < n; i++) {
      const k = readStr(pos);
      const v = readStr(k.next);
      d[k.s] = v.s;
      pos = v.next;
    }
    return { d, next: pos };
  };
  let p = 8;
  const models = []; // { size:{x,y,z} vox 口径, xyzi }
  let pendingSize = null;
  const palette = defaultPalette();
  const matlRaw = {};
  const nodes = new Map();
  while (p + 12 <= u8.length) {
    const id = tagAt(p);
    const content = dv.getInt32(p + 4, true);
    p += 12;
    if (id === 'MAIN') continue; // 子块紧随其后
    if (id === 'SIZE') {
      pendingSize = { x: dv.getInt32(p, true), y: dv.getInt32(p + 4, true), z: dv.getInt32(p + 8, true) };
    } else if (id === 'XYZI') {
      const n = dv.getInt32(p, true);
      models.push({ size: pendingSize, xyzi: u8.subarray(p + 4, p + 4 + n * 4) });
      pendingSize = null;
    } else if (id === 'RGBA') {
      palette.set(u8.subarray(p, p + 1024), 0);
    } else if (id === 'MATL') {
      try {
        const mid = dv.getInt32(p, true);
        if (mid >= 1 && mid <= 255) matlRaw[mid] = readDict(p + 4).d;
      } catch { /* 坏 MATL 不致命 */ }
    } else if (id === 'nTRN') {
      const nid = dv.getInt32(p, true);
      let q = readDict(p + 4).next;
      const child = dv.getInt32(q, true);
      const frames = dv.getInt32(q + 12, true);
      q += 16;
      let t = [0, 0, 0];
      for (let f = 0; f < frames; f++) {
        const r = readDict(q);
        if (r.d._r !== undefined) throw new Error('.vox 场景图含旋转 _r,暂不支持');
        if (r.d._t) t = r.d._t.split(' ').map(Number);
        q = r.next;
      }
      nodes.set(nid, { kind: 'trn', child, t });
    } else if (id === 'nGRP') {
      const nid = dv.getInt32(p, true);
      let q = readDict(p + 4).next;
      const n = dv.getInt32(q, true);
      q += 4;
      const children = [];
      for (let i = 0; i < n; i++) { children.push(dv.getInt32(q, true)); q += 4; }
      nodes.set(nid, { kind: 'grp', children });
    } else if (id === 'nSHP') {
      const nid = dv.getInt32(p, true);
      let q = readDict(p + 4).next;
      const n = dv.getInt32(q, true);
      q += 4;
      const ms = [];
      for (let i = 0; i < n; i++) {
        ms.push(dv.getInt32(q, true));
        q = readDict(q + 4).next;
      }
      nodes.set(nid, { kind: 'shp', models: ms });
    }
    p += content;
  }
  if (!models.length || !models[0].size) throw new Error('.vox 缺 SIZE/XYZI 块');
  // 摆放:场景图(root=0 号 nTRN)累加 _t;模型 min 角 = t - floor(size/2)。无场景图=单模型落原点。
  const placed = [];
  const hasGraph = [...nodes.values()].some((n) => n.kind === 'shp');
  if (hasGraph) {
    const visit = (nid, tx, ty, tz) => {
      const node = nodes.get(nid);
      if (!node) return;
      if (node.kind === 'trn') visit(node.child, tx + node.t[0], ty + node.t[1], tz + node.t[2]);
      else if (node.kind === 'grp') for (const c of node.children) visit(c, tx, ty, tz);
      else for (const mi of node.models) {
        const m = models[mi];
        if (m) placed.push({ m, min: [tx - (m.size.x >> 1), ty - (m.size.y >> 1), tz - (m.size.z >> 1)] });
      }
    };
    visit(0, 0, 0, 0);
  }
  if (!placed.length) placed.push({ m: models[0], min: [0, 0, 0] });
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const pl of placed) {
    minX = Math.min(minX, pl.min[0]); maxX = Math.max(maxX, pl.min[0] + pl.m.size.x);
    minY = Math.min(minY, pl.min[1]); maxY = Math.max(maxY, pl.min[1] + pl.m.size.y);
    minZ = Math.min(minZ, pl.min[2]); maxZ = Math.max(maxZ, pl.min[2] + pl.m.size.z);
  }
  const DX = maxX - minX, DY = maxY - minY, DZ = maxZ - minZ;
  // vox 世界 → three:sx=DX, sy=DZ, sz=DY
  const dense = makeDense(DX, DZ, DY);
  for (const pl of placed) {
    const xy = pl.m.xyzi;
    for (let k = 0; k < xy.length; k += 4) {
      const wx = pl.min[0] + xy[k] - minX;
      const wy = pl.min[1] + xy[k + 1] - minY;
      const wz = pl.min[2] + xy[k + 2] - minZ;
      const tz = DY - 1 - wy;
      dense.data[wx + DX * (wz + DZ * tz)] = xy[k + 3];
    }
  }
  const materials = new Array(256).fill(null);
  for (const [id, d] of Object.entries(matlRaw)) materials[+id] = normalizeMatl(d);
  return { dense, palette, materials, matlRaw };
}

// 手修安全网(docs/VOXEL_PLAN.md §5-8):MagicaVoxel 默认调色板兜底——
// 若 .vox 无 RGBA 块(极旧文件)仍可解析;正常路径我们的文件总带 RGBA。
function defaultPalette() {
  const pal = new Uint8Array(1024);
  for (let i = 0; i < 256; i++) {
    pal[i * 4] = pal[i * 4 + 1] = pal[i * 4 + 2] = 200;
    pal[i * 4 + 3] = 255;
  }
  return pal;
}

// 调色板小工具:hex('#rrggbb') 写进 palette 的 index 槽(1..255)
export function setPaletteColor(palette, index, hex) {
  if (index < 1 || index > 255) throw new Error(`调色板索引越界: ${index}`);
  const n = parseInt(hex.slice(1), 16);
  const o = (index - 1) * 4;
  palette[o] = (n >> 16) & 255;
  palette[o + 1] = (n >> 8) & 255;
  palette[o + 2] = n & 255;
  palette[o + 3] = 255;
}
export function getPaletteHex(palette, index) {
  const o = (index - 1) * 4;
  return `#${((palette[o] << 16) | (palette[o + 1] << 8) | palette[o + 2]).toString(16).padStart(6, '0')}`;
}
