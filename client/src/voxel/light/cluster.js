// 发光体素 → 虚拟点光(P1-4):把发光体(16cm 网格)做 6-连通洪泛聚类,
// 每簇归约成一盏「虚拟点光」{pos=亮度加权质心, color=能量色归一, power=Σ亮度}。
// 这是「素材发光照亮环境」的核心解法:摆一盏体素灯 → 聚成点光 → 与吊灯/炉火共用
// 可见度体积通道(RGBA 共 4 盏)→ 有软阴影的真实照明;渲染端零特判。
// 排除规则:距已配置真实灯 < excludeR 的簇丢弃(吊灯烛焰本身就是 chandelier 点光的来源,
// 不排除会双计)。纯函数,node 单测。
import { DOMAIN } from './domain.js';

const LUM = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * findEmissiveLights(domain, {exclude=[], excludeR=1.5, maxLights=2, minPower=0.5, mergeR=1.3}) →
 *   [{ pos:[x,y,z], color:[r,g,b](0..1 归一), power }](按 power 降序,≤maxLights)
 * exclude: [[x,y,z], …] 真实灯位。power = Σ格亮度(线性色×emitK),供强度标定。
 * mergeR: 近簇并灯半径(一件灯具多个发光部件=一盏灯;见函数尾注释)。
 */
export function findEmissiveLights(domain, opts = {}) {
  const { anx, any: ay, anz, albCell, origin } = DOMAIN;
  const exclude = opts.exclude ?? [];
  const excludeR2 = (opts.excludeR ?? 1.5) ** 2;
  const maxLights = opts.maxLights ?? 2;
  const minPower = opts.minPower ?? 0.5;
  const emi = domain.emi;
  const seen = new Uint8Array(anx * ay * anz);
  const clusters = [];
  const stack = [];
  for (let iz = 0; iz < anz; iz++) {
    for (let iy = 0; iy < ay; iy++) {
      for (let ix = 0; ix < anx; ix++) {
        const i0 = ix + anx * (iy + ay * iz);
        if (seen[i0] || LUM(emi[i0 * 3], emi[i0 * 3 + 1], emi[i0 * 3 + 2]) < 0.02) continue;
        // 洪泛一簇
        let power = 0, cr = 0, cg = 0, cb = 0, wx = 0, wy = 0, wz = 0;
        stack.length = 0;
        stack.push(ix, iy, iz);
        seen[i0] = 1;
        while (stack.length) {
          const z = stack.pop(), y = stack.pop(), x = stack.pop();
          const i = x + anx * (y + ay * z);
          const r = emi[i * 3], g = emi[i * 3 + 1], b = emi[i * 3 + 2];
          const w = LUM(r, g, b);
          power += w; cr += r; cg += g; cb += b;
          wx += w * x; wy += w * y; wz += w * z;
          const nb = [[x - 1, y, z], [x + 1, y, z], [x, y - 1, z], [x, y + 1, z], [x, y, z - 1], [x, y, z + 1]];
          for (const [nx2, ny2, nz2] of nb) {
            if (nx2 < 0 || ny2 < 0 || nz2 < 0 || nx2 >= anx || ny2 >= ay || nz2 >= anz) continue;
            const ni = nx2 + anx * (ny2 + ay * nz2);
            if (seen[ni]) continue;
            if (LUM(emi[ni * 3], emi[ni * 3 + 1], emi[ni * 3 + 2]) < 0.02) continue;
            seen[ni] = 1;
            stack.push(nx2, ny2, nz2);
          }
        }
        if (power < minPower) continue;
        const pos = [
          origin[0] + (wx / power + 0.5) * albCell,
          origin[1] + (wy / power + 0.5) * albCell,
          origin[2] + (wz / power + 0.5) * albCell,
        ];
        const m = Math.max(cr, cg, cb) || 1;
        clusters.push({ pos, color: [cr / m, cg / m, cb / m], power });
      }
    }
  }
  const kept = clusters.filter((c) =>
    !exclude.some((e) => (c.pos[0] - e[0]) ** 2 + (c.pos[1] - e[1]) ** 2 + (c.pos[2] - e[2]) ** 2 < excludeR2));
  kept.sort((a, b) => b.power - a.power);
  // 近簇合并(E.5):一件灯具常聚出多簇(双层吊灯上下灯柱圈相距 ~0.4-0.7m)——白占
  // 两个灯槽且运行时灯循环成本翻倍。mergeR 内并成一盏(能量加权质心/色取峰/能量求和);
  // 按能量降序贪心,强簇作宿主。发生在 maxLights 截断**之前**,腾出的槽让给别的灯具。
  const mergeR2 = (opts.mergeR ?? 1.3) ** 2;
  const merged = [];
  for (const c of kept) {
    const host = merged.find((m) =>
      (m.pos[0] - c.pos[0]) ** 2 + (m.pos[1] - c.pos[1]) ** 2 + (m.pos[2] - c.pos[2]) ** 2 < mergeR2);
    if (host) {
      const total = host.power + c.power;
      host.pos = host.pos.map((v, i) => (v * host.power + c.pos[i] * c.power) / total);
      host.color = host.color.map((v, i) => Math.max(v, c.color[i]));
      host.power = total;
    } else {
      merged.push({ pos: [...c.pos], color: [...c.color], power: c.power });
    }
  }
  merged.sort((a, b) => b.power - a.power);
  return merged.slice(0, maxLights);
}
