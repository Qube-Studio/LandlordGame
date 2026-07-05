// 圈边浮字统一载体（验收修订②⑤）：
// - 双锚点：nw=false 悬在自己圆圈正上方（LOBBY/DISCUSSION 等圈内不会有钱的阶段）；
//   nw=true 滑到圈「西北」压低让位（BETTING 起圈内可能有钱，哪怕当前没有）。
// - 姿态存模块级（座位局部系）：跨阶段/跨组件（FeltPrompts→HandLayer→PayoutLayer）换装时
//   从上一位置继续阻尼滑向新锚点，不跳位。HandLayer 挂在世界系，传 rot 由本组件转换。
// - 受击动效（pushFloat）：只给【非交互】文字行——等待中的玩家可以戳着玩（无功能的小玩具）；
//   可交互行不加（按钮要的是干脆确定的反馈）。板子顺着点击位置被推一把：浮字是屏幕空间 2D，
//   用 CSS perspective+rotate3d 伪 3D——戳哪边哪边倒进去、戳正中整块下沉，衰减晃回正。
/* eslint-disable react-refresh/only-export-components */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { promptAnchor, promptAnchorHome } from './cards';

const UP = new THREE.Vector3(0, 1, 0);
const _pose = new THREE.Vector3(); // 模块级：同一时刻全局至多一个主浮字，跨挂载保留
let _posed = false;

const REDUCED = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// 受击：把整块浮字板顺着点击方向推倒一点再弹回（挂在非交互行的 onPointerDown 上）。
// 倾倒轴/幅度由点击点相对板心的偏移决定（经典卡片倾斜公式 rx=-dy·A, ry=dx·A）；
// 正中点击 dx,dy≈0 → 纯 translateZ 直沉。WAAPI 一次性动画，连点自然覆盖重触发。
export function pushFloat(e) {
  if (REDUCED) return;
  const board = e.currentTarget.closest('.felt-float');
  if (!board || !board.animate) return;
  const r = board.getBoundingClientRect();
  const dx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2 || 1)));
  const dy = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2 || 1)));
  const rx = -dy * 16, ry = dx * 16;
  const P = 'perspective(340px)';
  board.animate([
    { transform: `${P}` },
    { transform: `${P} rotateX(${rx}deg) rotateY(${ry}deg) translateZ(-12px)`, offset: 0.2 },
    { transform: `${P} rotateX(${-rx * 0.4}deg) rotateY(${-ry * 0.4}deg) translateZ(-3px)`, offset: 0.55 },
    { transform: `${P} rotateX(${rx * 0.12}deg) rotateY(${ry * 0.12}deg)`, offset: 0.8 },
    { transform: `${P}` },
  ], { duration: 450, easing: 'ease-out' });
}

export default function PromptFloat({ spot, nw = false, rot = 0, distanceFactor = 4.2, zIndexRange = [28, 0], children }) {
  const g = useRef();
  const target = useMemo(
    () => new THREE.Vector3(...(nw ? promptAnchor(spot.x, spot.z) : promptAnchorHome(spot.x, spot.z))),
    [spot.x, spot.z, nw],
  );
  useFrame((_, dt) => {
    if (_posed) _pose.lerp(target, 1 - Math.exp(-7 * (dt || 0.016)));
    else { _pose.copy(target); _posed = true; }
    const gg = g.current;
    if (!gg) return;
    gg.position.copy(_pose);
    if (rot) gg.position.applyAxisAngle(UP, rot);
  });
  return (
    // 初始位藏到桌下：Html 会在首帧 useFrame 前先按初始位渲染一次，避免原点闪现
    <group ref={g} position={[0, -50, 0]}>
      <Html center distanceFactor={distanceFactor} zIndexRange={zIndexRange}>
        {/* 受击接在整块板上（.poke 开 pointer-events）——行间缝隙也可戳、多行一体推；
            可交互行例外（.clickable 自己的点击反馈要干脆，不跟着晃） */}
        <div className="felt-float poke" onPointerDown={(e) => { if (!e.target.closest('.clickable')) pushFloat(e); }}>
          {children}
        </div>
      </Html>
    </group>
  );
}
