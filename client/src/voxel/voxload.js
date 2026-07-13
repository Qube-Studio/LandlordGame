// .vox 运行时加载:fetch → 解析 → 贪心合并 → BufferGeometry(按 url+选项缓存)。
// 浏览器侧唯一带 three 依赖的体素模块;vox.js/greedy.js 保持纯函数可单测。
import * as THREE from 'three';
import { parseVox, getPaletteHex } from './vox';
import { greedyMesh } from './greedy';

const CACHE = new Map(); // key → Promise<{ main, emissive, size, voxelCount, quadCount }>

const toGeometry = (part) => {
  if (!part) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(part.colors, 3));
  g.computeBoundingSphere();
  return g;
};

/**
 * loadVox(url, { emissiveColors?: string[] }) → Promise<{
 *   main: BufferGeometry, emissive: BufferGeometry|null,
 *   size: {x,y,z}(体素数,three 轴向), quadCount
 * }>
 * emissiveColors:按 hex 匹配调色板 → 这些颜色的体素拆进 emissive 几何
 * (材质由消费组件定;匹配按 hex 而非索引,资产手修重排调色板也不脆断)。
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
      const { dense, palette } = parseVox(buf);
      let emissiveIndices = null;
      if (opts.emissiveColors?.length) {
        const want = new Set(opts.emissiveColors.map((h) => h.toLowerCase()));
        emissiveIndices = new Set();
        for (let i = 1; i < 256; i++) {
          if (want.has(getPaletteHex(palette, i))) emissiveIndices.add(i);
        }
      }
      const { main, emissive, quadCount } = greedyMesh(dense, palette, { emissiveIndices });
      return {
        main: toGeometry(main),
        emissive: toGeometry(emissive),
        size: { x: dense.sx, y: dense.sy, z: dense.sz },
        quadCount,
      };
    });
  CACHE.set(key, p);
  p.catch(() => CACHE.delete(key)); // 失败不缓存,可重试
  return p;
}
