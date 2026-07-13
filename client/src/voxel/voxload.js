// .vox 运行时加载:fetch → 解析 → 贪心合并 → BufferGeometry(按 url+选项缓存)。
// 浏览器侧唯一带 three 依赖的体素模块;vox.js/greedy.js 保持纯函数可单测。
// P0-3:MATL 材质走通——发光/金属/玻璃按 MATL 分桶;hex 匹配保留为旧资产回退(与 MATL 取并集)。
import * as THREE from 'three';
import { parseVox, getPaletteHex } from './vox';
import { greedyMesh } from './greedy';

const CACHE = new Map(); // key → Promise<{ main, emissive, glass, size, quadCount, glassAlpha, glassRough }>

const toGeometry = (part) => {
  if (!part) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(part.colors, 3));
  // 第二套顶点属性(P0-3):aRm=粗糙/金属(normalized),aEmit=发光强度。
  // 永远附上(无 MATL 时默认 rough1/metal0/emitK)——缺属性时 WebGL 默认 (0,0) 会把 roughness 打成 0。
  g.setAttribute('aRm', new THREE.BufferAttribute(part.rm, 2, true));
  g.setAttribute('aEmit', new THREE.BufferAttribute(part.emit, 1));
  g.computeBoundingSphere();
  return g;
};

/**
 * loadVox(url, { emissiveColors?: string[] }) → Promise<{
 *   main, emissive, glass: BufferGeometry|null,
 *   glassAlpha, glassRough: number(玻璃桶均值,无玻璃时 undefined),
 *   size: {x,y,z}(体素数,three 轴向), quadCount
 * }>
 * 材质来源:.vox 的 MATL 块(权威);emissiveColors 按 hex 匹配调色板作回退
 * (无 MATL 的旧资产/手修重排调色板不脆断),与 MATL 取并集。
 */
export function loadVox(url, opts = {}) {
  const key = `${url}|${(opts.emissiveColors ?? []).join(',')}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const p = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`加载 .vox 失败 ${r.status}: ${url}`);
      return r.arrayBuffer();
    })
    .then((buf) => {
      const { dense, palette, materials } = parseVox(buf);
      let emissiveIndices = null;
      if (opts.emissiveColors?.length) {
        const want = new Set(opts.emissiveColors.map((h) => h.toLowerCase()));
        emissiveIndices = new Set();
        for (let i = 1; i < 256; i++) {
          if (want.has(getPaletteHex(palette, i))) emissiveIndices.add(i);
        }
      }
      const { main, emissive, glass, quadCount } = greedyMesh(dense, palette, { materials, emissiveIndices });
      return {
        main: toGeometry(main),
        emissive: toGeometry(emissive),
        glass: toGeometry(glass),
        glassAlpha: glass?.alpha,
        glassRough: glass?.rough,
        size: { x: dense.sx, y: dense.sy, z: dense.sz },
        quadCount,
      };
    });
  CACHE.set(key, p);
  p.catch(() => CACHE.delete(key)); // 失败不缓存,可重试
  return p;
}
