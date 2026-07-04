// 桌面钱牌共享基元（Scene3D 与 PayoutLayer 共用，保证飞行/静堆/彩池视觉同源）：
// 双面材质、堆叠槽位公式、静态钱堆组件、世界坐标→世界坐标的通用弧线飞牌 ArcNote。
// 常量/工具与组件混导出是本模块的职责所在，Fast refresh 提示不适用。
/* eslint-disable react-refresh/only-export-components */
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { noteTexture } from './textures';
import PixelText from '../assets/pixelfont/PixelText';
import { P, DENOM_COLORS } from '../assets/palette';

export const TABLE_TOP = 1.0;
export const CARD_W = 0.42, CARD_T = 0.05, CARD_D = 0.58;

// 双面钞票卡材质：+y(顶)=正面值，-y(底)=反面；正/反由 rotation.x（0 / π）决定。
// 按 面额|债务 缓存；债务牌 = 红色变体（协商/缺口的欠账标记）。
const CARD_MATS = new Map();
export function cardMaterials(value, debt = false) {
  const key = `${value}|${debt ? 1 : 0}`;
  if (CARD_MATS.has(key)) return CARD_MATS.get(key);
  const face = new THREE.MeshStandardMaterial({ map: noteTexture({ value, debt }), roughness: 0.85, flatShading: true });
  const back = new THREE.MeshStandardMaterial({ map: noteTexture({ faceDown: true }), roughness: 0.85, flatShading: true });
  // 边缘按面额 accent 色带(银行捆钞感,侧看一眼识面额)；债务牌用 DEBT accent
  const edge = new THREE.MeshStandardMaterial({
    color: (debt ? DENOM_COLORS.DEBT : DENOM_COLORS[value] ?? DENOM_COLORS[1]).accent,
    roughness: 1, flatShading: true,
  });
  const mats = [edge, edge, face, back, edge, edge]; // px,nx,py(正),ny(反),pz,nz
  CARD_MATS.set(key, mats);
  return mats;
}

// 钱堆布局：把牌分成若干小叠聚成一小堆，比单列细塔更有「钱多」的体量感。
// 飞行落点与静态钱堆共用 cardLocal，保证无缝接力。
export const STACK_CAP = 36;   // 单堆最多渲染张数（超出只影响视觉，金额标签仍显示真实值）
const COL_H = 5;               // 每小叠张数
const STACK_SPOTS = [          // 各小叠在桌面上的散布位置（相对钱堆中心），随叠数外扩
  [0, 0], [0.17, 0.07], [-0.15, 0.11], [0.07, -0.17], [-0.11, -0.15],
  [0.21, -0.08], [-0.2, -0.04], [0.04, 0.19],
];
export const cardLocal = (i) => {
  const col = Math.floor(i / COL_H);
  const row = i % COL_H;
  const [sx, sz] = STACK_SPOTS[col % STACK_SPOTS.length];
  return [sx + ((row % 2) - 0.5) * 0.025, TABLE_TOP + 0.03 + row * 0.045 + col * 0.012, sz + Math.sin(row * 2.1) * 0.02];
};
export const cardYaw = (i) => ((i * 37) % 34 - 17) * Math.PI / 180;
// 钱堆顶部（用于悬浮标签）：取最高小叠的高度
export const stackTopY = (count) => TABLE_TOP + 0.06 + Math.min(count, COL_H) * 0.045;
// 反面占位牌（下注阶段对手只露张数，不露面额）
export const blankNotes = (n) => Array.from({ length: Math.max(0, Math.min(n, STACK_CAP)) }, (_, i) => ({ id: `b${i}`, value: 1 }));

export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// 静态钱堆（下注堆 / 彩池 / 派送后的圆圈堆 / 红色债务标记共用）。
// onNoteDown(note, i, event)：可选的逐张 pointerdown 入口（协商 3D 拖拽用），不传则纯展示。
export function MoneyStack({ notes, faceUp, position, amount = null, labelColor = P.gold, onNoteDown }) {
  const shown = notes.slice(0, STACK_CAP);
  const topY = stackTopY(shown.length);
  return (
    <group position={position}>
      {shown.map((n, i) => (
        <mesh
          key={n.id ?? i}
          material={cardMaterials(n.value, n.debt)}
          position={cardLocal(i)}
          rotation={[faceUp ? 0 : Math.PI, cardYaw(i), 0]}
          castShadow
          onPointerDown={onNoteDown ? (e) => onNoteDown(n, i, e) : undefined}
        >
          <boxGeometry args={[CARD_W, CARD_T, CARD_D]} />
        </mesh>
      ))}
      {/* 不显示张数；金额仅在可见时标注（自己的堆始终可见，他人堆揭牌后可见） */}
      {amount != null && (
        <Html position={[0, topY + 0.15, 0]} center distanceFactor={6.5} zIndexRange={[20, 0]}>
          <div className="money-3d-amount"><PixelText size={2} color={labelColor}>{`¥${amount}`}</PixelText></div>
        </Html>
      )}
    </group>
  );
}

/**
 * 世界坐标→世界坐标的弧线飞牌（结算编导的基本笔画）：
 * 沿二次贝塞尔弧（弧顶 = 两端较高点 + apex）飞行，yaw 落定时精确等于 yawEnd（与静堆槽位无缝接力）、
 * 途中叠加驼峰式自旋；growIn = 从手/凭空飞出的渐入，shrinkOut = 收进手/身体/凭空消失的渐出。
 */
export function ArcNote({ value, debt = false, from, to, delay = 0, duration = 0.62, apex = 0.75, yawEnd = 0, growIn = false, shrinkOut = false, onDone }) {
  const ref = useRef();
  const t0 = useRef(null);
  const done = useRef(false);
  useFrame((st) => {
    const m = ref.current;
    if (!m) return;
    if (t0.current == null) t0.current = st.clock.elapsedTime;
    const raw = (st.clock.elapsedTime - t0.current - delay) / Math.max(duration, 0.001);
    const t = Math.min(1, Math.max(0, raw));
    m.visible = raw >= 0;
    const e = easeInOut(t);
    const a = 1 - e;
    const cx = (from[0] + to[0]) / 2, cz = (from[2] + to[2]) / 2;
    const cy = Math.max(from[1], to[1]) + apex;
    m.position.set(
      a * a * from[0] + 2 * a * e * cx + e * e * to[0],
      a * a * from[1] + 2 * a * e * cy + e * e * to[1],
      a * a * from[2] + 2 * a * e * cz + e * e * to[2],
    );
    m.rotation.set(Math.sin(e * Math.PI) * 0.35, yawEnd * e + Math.sin(e * Math.PI) * 0.6, 0);
    const grow = growIn ? 0.45 + 0.55 * Math.min(1, e / 0.35) : 1;
    const shrink = shrinkOut ? (t > 0.6 ? Math.max(0.05, 1 - ((t - 0.6) / 0.4) * 0.95) : 1) : 1;
    const punch = !shrinkOut && t > 0.85 ? 1 + 0.15 * Math.sin(((t - 0.85) / 0.15) * Math.PI) : 1;
    m.scale.setScalar(grow * shrink * punch);
    if (t >= 1 && !done.current) { done.current = true; onDone?.(); }
  });
  return (
    <mesh ref={ref} material={cardMaterials(value, debt)} castShadow visible={false}>
      <boxGeometry args={[CARD_W, CARD_T, CARD_D]} />
    </mesh>
  );
}
