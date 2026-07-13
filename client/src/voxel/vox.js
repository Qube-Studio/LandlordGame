// MagicaVoxel .vox 读写(从零实现,docs/VOXEL_PLAN.md P0)。纯 typed-array,零依赖——
// 浏览器(voxload)与 node 工具(voxgen/voxtest)共用同一份。
// 坐标约定:.vox 是 z-up 右手系,three 是 y-up。互转规则(写死,勿改——已建资产依赖它):
//   three(x, y, z)  ⇔  vox(x, sizeThreeZ-1-z, y)
// 即 three 的 y 对应 vox 的 z(高度),three 的 z 沿 vox 的 y 反向。roundtrip 单测保证恒等。
// 调色板约定(MagicaVoxel 官方怪癖):体素存的索引 i ∈ 1..255,颜色在 RGBA 块的第 (i-1) 组
// 4 字节;索引 0 = 空。palette 参数统一用 256×4 的 Uint8Array,palette[(i-1)*4..] = RGBA。

const enc = (s) => [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)];

// 稠密体(three y-up 口径):{ sx, sy, sz, data: Uint8Array(sx*sy*sz) },index = x + sx*(y + sy*z),值=调色板索引(0 空)
export function makeDense(sx, sy, sz) {
  return { sx, sy, sz, data: new Uint8Array(sx * sy * sz) };
}
export const dIdx = (v, x, y, z) => x + v.sx * (y + v.sy * z);

// 写 .vox:dense(y-up) + palette(256×4 RGBA) → ArrayBuffer
export function writeVox(dense, palette) {
  const { sx, sy, sz, data } = dense;
  if (sx > 256 || sy > 256 || sz > 256) throw new Error(`vox 尺寸超 256: ${sx}×${sy}×${sz}`);
  // 收集非空体素(转 vox 坐标)
  const vox = [];
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        const i = data[x + sx * (y + sy * z)];
        if (i) vox.push(x, sz - 1 - z, y, i); // three→vox: (x, szThree-1-z, y)
      }
    }
  }
  const n = vox.length / 4;
  const sizeContent = 12;
  const xyziContent = 4 + n * 4;
  const rgbaContent = 1024;
  const childBytes = (12 + sizeContent) + (12 + xyziContent) + (12 + rgbaContent);
  const total = 8 + 12 + childBytes; // header + MAIN 头 + 子块
  const buf = new ArrayBuffer(total);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let p = 0;
  const tag = (s) => { u8.set(enc(s), p); p += 4; };
  const i32 = (v) => { dv.setInt32(p, v, true); p += 4; };
  tag('VOX '); i32(150);
  tag('MAIN'); i32(0); i32(childBytes);
  tag('SIZE'); i32(sizeContent); i32(0);
  i32(sx); i32(sz); i32(sy);           // vox SIZE 是 (x, y, z) z-up:x=sx, y=szThree, z=syThree
  tag('XYZI'); i32(xyziContent); i32(0);
  i32(n);
  for (let k = 0; k < vox.length; k += 4) {
    u8[p] = vox[k]; u8[p + 1] = vox[k + 1]; u8[p + 2] = vox[k + 2]; u8[p + 3] = vox[k + 3];
    p += 4;
  }
  tag('RGBA'); i32(rgbaContent); i32(0);
  u8.set(palette.subarray(0, 1024), p); p += 1024;
  return buf;
}

// 解析 .vox → { dense(y-up), palette(256×4) }。只认第一个模型;忽略 MATL 等扩展块(手修安全:不认识的块跳过)。
export function parseVox(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const tagAt = (p) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
  if (tagAt(0) !== 'VOX ') throw new Error('不是 .vox 文件');
  let p = 8;
  let size = null, xyzi = null;
  const palette = defaultPalette();
  while (p + 12 <= u8.length) {
    const id = tagAt(p);
    const content = dv.getInt32(p + 4, true);
    p += 12;
    if (id === 'MAIN') continue; // 子块紧随其后
    if (id === 'SIZE' && !size) {
      size = { x: dv.getInt32(p, true), y: dv.getInt32(p + 4, true), z: dv.getInt32(p + 8, true) };
    } else if (id === 'XYZI' && !xyzi) {
      const n = dv.getInt32(p, true);
      xyzi = u8.subarray(p + 4, p + 4 + n * 4);
    } else if (id === 'RGBA') {
      palette.set(u8.subarray(p, p + 1024), 0);
    }
    p += content;
  }
  if (!size || !xyzi) throw new Error('.vox 缺 SIZE/XYZI 块');
  // vox(x,y,z z-up) → three:sx=size.x, sy=size.z, sz=size.y
  const dense = makeDense(size.x, size.z, size.y);
  const { sx, sy } = dense;
  for (let k = 0; k < xyzi.length; k += 4) {
    const vx = xyzi[k], vy = xyzi[k + 1], vz = xyzi[k + 2], ci = xyzi[k + 3];
    const tz = size.y - 1 - vy;
    dense.data[vx + sx * (vz + sy * tz)] = ci;
  }
  return { dense, palette };
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
