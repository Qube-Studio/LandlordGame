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

// ---- MATL 材质字典(MagicaVoxel DICT 结构:int32 n + n×(STRING key, STRING value),STRING=int32 len+bytes) ----
const te = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const td = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
const strBytes = (s) => te.encode(s);
const dictByteLen = (dict) => {
  let n = 4;
  for (const [k, v] of Object.entries(dict)) n += 8 + strBytes(k).length + strBytes(String(v)).length;
  return n;
};

// 归一化一条 MATL 记录(MagicaVoxel 新旧字段兼容:_weight 是旧版 _metal/_emit 的载体,_trans 是旧版 _alpha)
// → { type, rough, metal, emitK, alpha }。emitK = _emit × 2^(_flux-1):flux 默认 1 时 emitK=emit,
// 与现有 hex 发光路径的"强度 1×prop"口径对齐。
function normalizeMatl(dict) {
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

// 写 .vox:dense(y-up) + palette(256×4 RGBA) [+ materials] → ArrayBuffer
// materials(可选):稀疏数组/对象,materials[i](i∈1..255)= MATL DICT(如 {_type:'_emit',_emit:'1',_flux:'1'})。
// 写出 MATL 让生成资产与 MagicaVoxel 手修资产走同一条运行时路径(手修=改材质面板即生效)。
export function writeVox(dense, palette, materials = null) {
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
  const matlEntries = [];
  if (materials) {
    for (let i = 1; i <= 255; i++) {
      if (materials[i]) matlEntries.push([i, materials[i]]);
    }
  }
  const n = vox.length / 4;
  const sizeContent = 12;
  const xyziContent = 4 + n * 4;
  const rgbaContent = 1024;
  let childBytes = (12 + sizeContent) + (12 + xyziContent) + (12 + rgbaContent);
  for (const [, dict] of matlEntries) childBytes += 12 + 4 + dictByteLen(dict);
  const total = 8 + 12 + childBytes; // header + MAIN 头 + 子块
  const buf = new ArrayBuffer(total);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let p = 0;
  const tag = (s) => { u8.set(enc(s), p); p += 4; };
  const i32 = (v) => { dv.setInt32(p, v, true); p += 4; };
  const str = (s) => { const b = strBytes(s); i32(b.length); u8.set(b, p); p += b.length; };
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
  for (const [idx, dict] of matlEntries) {
    tag('MATL'); i32(4 + dictByteLen(dict)); i32(0);
    i32(idx);
    const entries = Object.entries(dict);
    i32(entries.length);
    for (const [k, v] of entries) { str(k); str(String(v)); }
  }
  return buf;
}

// 解析 .vox → { dense(y-up), palette(256×4), materials }。只认第一个模型;不认识的块跳过(手修安全)。
// materials:Array(256),materials[i] = normalizeMatl 归一化记录或 null(无 MATL / _diffuse 默认可为记录)。
export function parseVox(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const tagAt = (p) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
  if (tagAt(0) !== 'VOX ') throw new Error('不是 .vox 文件');
  let p = 8;
  let size = null, xyzi = null;
  const palette = defaultPalette();
  const materials = new Array(256).fill(null);
  const readDict = (q) => {
    const n = dv.getInt32(q, true); q += 4;
    const dict = {};
    for (let i = 0; i < n; i++) {
      const kl = dv.getInt32(q, true); q += 4;
      const k = td.decode(u8.subarray(q, q + kl)); q += kl;
      const vl = dv.getInt32(q, true); q += 4;
      dict[k] = td.decode(u8.subarray(q, q + vl)); q += vl;
    }
    return dict;
  };
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
    } else if (id === 'MATL') {
      // MATL = int32 材质 id(=调色板索引) + DICT;越界/坏字典静默跳过(手修安全网)
      try {
        const mid = dv.getInt32(p, true);
        if (mid >= 1 && mid <= 255) materials[mid] = normalizeMatl(readDict(p + 4));
      } catch { /* 坏 MATL 不致命 */ }
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
  return { dense, palette, materials };
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
