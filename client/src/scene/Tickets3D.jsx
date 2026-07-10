// 对质票 3D 模型（§8.8）：邮票造型——左右锯齿轮廓真实建模（挤出几何，非贴图假装），有纸币厚度。
// 网格/配色走 assets/ticketArt.js 单一真源（与 2D PixelTicket、3D 贴图一致）。
// - `TicketRow`：一名玩家的一排票（间距>票宽=绝不重叠错位；>ROW_N 张换行，第二排朝玩家再近一点）。
//   排在玩家圈外「桌心→座位」方向前移处、随座位偏航朝向玩家。onTicketDown 可选（NEGOTIATE 拖拽转赠用）。
// - `Tickets3D`：CHALLENGE 期自己的那排（Scene3D 挂载）。
// 尺寸/位置皆可调常量，真机看效果微调。
/* eslint-disable react-refresh/only-export-components */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TABLE_TOP } from './cards';
import { ticketTexture } from './textures';
import { TICKET_COLS, TICKET_ROWS, TICKET_PAPER, TOOTH_DEPTH, ticketRowWide } from '../assets/ticketArt';

export const TICKET_W = 0.26;                                // 票宽（世界单位）
export const TICKET_H = TICKET_W * TICKET_ROWS / TICKET_COLS; // 票高（按网格纵横比）
export const TICKET_THK = 0.024;                             // 纸厚（≈钱牌厚度）
const CELL = TICKET_W / TICKET_COLS;   // 一格像素的世界尺寸
const SPACING = TICKET_W + 0.06;       // 相邻票间距（> 票宽 → 永不重叠）
const ROW_N = 4;                       // 每排张数
const ROW_STEP = TICKET_H + 0.07;      // 排间距（第二排向玩家再挪近）
const FWD = 0.52;                      // 从圈心向座位方向的前移量
const LIFT = 0.012;                    // 抬离毡面（防 z-fight/穿模）
export const TICKET_MAXN = 8;

// 锯齿挤出几何（网格坐标系 0..cols × 0..rows，单位=格；偶数行出挑满宽、奇数行两侧各缩 1 格）。
// UV 即网格原始坐标 → 贴图 repeat=(1/cols,1/rows) 换算；材质组 0=上下面(贴图)、1=侧壁(纸色)。
// 几何居中 + 平躺（面朝 +y、翻盖朝局部 -z）+ 缩到世界尺寸，单例共享。
let _geo = null;
export function ticketGeometry() {
  if (_geo) return _geo;
  const R = (r) => (ticketRowWide(r) ? TICKET_COLS : TICKET_COLS - TOOTH_DEPTH); // 齿深 2 格（粗齿）
  const L = (r) => (ticketRowWide(r) ? 0 : TOOTH_DEPTH);
  const shape = new THREE.Shape();
  shape.moveTo(L(0), 0);
  shape.lineTo(R(0), 0);
  let cx = R(0);
  for (let y = 1; y <= TICKET_ROWS - 1; y++) {      // 右缘锯齿（自下而上）
    const nx = R(y);
    if (nx !== cx) { shape.lineTo(cx, y); shape.lineTo(nx, y); cx = nx; }
  }
  shape.lineTo(cx, TICKET_ROWS);
  shape.lineTo(L(TICKET_ROWS - 1), TICKET_ROWS);
  cx = L(TICKET_ROWS - 1);
  for (let y = TICKET_ROWS - 1; y >= 1; y--) {      // 左缘锯齿（自上而下）
    const nx = L(y - 1);
    if (nx !== cx) { shape.lineTo(cx, y); shape.lineTo(nx, y); cx = nx; }
  }
  const depth = TICKET_THK / CELL; // 厚度换算成格
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(-TICKET_COLS / 2, -TICKET_ROWS / 2, -depth / 2);
  geo.rotateX(-Math.PI / 2);       // 平躺：面朝 +y；shape 上缘（翻盖侧）转到局部 -z（桌心侧）
  geo.scale(CELL, CELL, CELL);
  _geo = geo;
  return geo;
}

// 六面材质（组 0=上下贴图、组 1=侧壁纸色），单例共享；贴图 UV 从网格坐标换算。
// 票面用**受光**材质（与桌面钱牌一致）：吃暖光/阴影，配合贴图纸纹才有纸的质感（unlit 死平被打回）。
let _mats = null;
export function ticketMaterials() {
  if (_mats) return _mats;
  const tex = ticketTexture();
  tex.repeat.set(1 / TICKET_COLS, 1 / TICKET_ROWS);
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0, flatShading: true });
  const side = new THREE.MeshStandardMaterial({ color: TICKET_PAPER, roughness: 0.85, metalness: 0, flatShading: true });
  _mats = [face, side];
  return _mats;
}

// 第 i 张票在自己排里的局部偏移（切向 off、纵向 row）——布局唯一真源，拖拽起点/飞行落点也从这取。
export function ticketSlot(i, n) {
  const rows = Math.ceil(Math.min(n, TICKET_MAXN) / ROW_N);
  const row = Math.floor(i / ROW_N);
  const inRow = Math.min(n - row * ROW_N, ROW_N);
  const col = i % ROW_N;
  return { off: (col - (inRow - 1) / 2) * SPACING, fwd: (row - (rows - 1) / 2) * ROW_STEP };
}

// 第 i/n 张票的世界位（场景旋转组局部系）+ 该排偏航——TicketRow 摆放与 PayoutLayer 飞行落点共用。
export function ticketWorldPos(seat, spot, i, n) {
  const on = Math.hypot(seat.x, seat.z) || 1;
  const ox = seat.x / on, oz = seat.z / on;   // 外向单位（桌心→座位）
  const tx = -oz, tz = ox;                    // 切向单位
  const yaw = Math.atan2(ox, oz);             // 票面朝向玩家
  const bx = spot.x + ox * FWD, bz = spot.z + oz * FWD;
  const { off, fwd } = ticketSlot(i, n);
  return { pos: [bx + tx * off + ox * fwd, TABLE_TOP + LIFT + TICKET_THK / 2, bz + tz * off + oz * fwd], yaw };
}

// 一名玩家的一排票。seat 定外向/偏航，spot 定圈心；onTicketDown(i,e) 可选（自己的票拖拽转赠）。
export function TicketRow({ count, seat, spot, onTicketDown }) {
  const geo = useMemo(() => ticketGeometry(), []);
  const mats = useMemo(() => ticketMaterials(), []);
  const n = Math.min(Math.max(0, count | 0), TICKET_MAXN);
  if (n <= 0) return null;
  const cards = [];
  for (let i = 0; i < n; i++) {
    const { pos, yaw } = ticketWorldPos(seat, spot, i, n);
    cards.push(
      <mesh
        key={i}
        geometry={geo}
        material={mats}
        position={pos}
        rotation={[0, yaw, 0]}
        castShadow
        onPointerDown={onTicketDown ? (e) => onTicketDown(i, e) : undefined}
      />,
    );
  }
  return <>{cards}</>;
}

// 票的弧线飞行（转赠落定/未落圈飞回，PayoutLayer 用）：二次贝塞尔，落地回调一次。
export function TicketArc({ from, to, yaw = 0, dur = 300, onLand }) {
  const ref = useRef();
  const t0 = useRef(null);
  const done = useRef(false);
  useFrame(() => {
    const m = ref.current;
    if (!m || done.current) return;
    const now = performance.now();
    if (t0.current == null) t0.current = now;
    const t = Math.min(1, (now - t0.current) / dur);
    const e = 1 - (1 - t) ** 2;                        // easeOutQuad：出手快、落点缓
    const apex = Math.max(from[1], to[1]) + 0.28;      // 弧顶
    const u = 1 - e;
    const midY = u * u * from[1] + 2 * u * e * apex + e * e * to[1];
    m.position.set(from[0] + (to[0] - from[0]) * e, midY, from[2] + (to[2] - from[2]) * e);
    m.visible = true;
    if (t >= 1) { done.current = true; onLand?.(); }
  });
  return <mesh ref={ref} geometry={ticketGeometry()} material={ticketMaterials()} rotation={[0, yaw, 0]} castShadow visible={false} />;
}

// CHALLENGE 期自己的那排（Scene3D 挂载；场景旋转组内、raw 座标系）。
export default function Tickets3D({ count, mySeat, mySpot }) {
  return <TicketRow count={count} seat={mySeat} spot={mySpot} />;
}
