// 处决窗行刑者相机（§3.9，多人 · 桌面 3D）：挂载即从 CameraRig 手中接管——指针锁 + 定点自由环视
// + 三态准心瞄准 + 左键开枪。卸载即交还（CameraRig 的阻尼 lerp 自动柔和追平）。
// 指针锁管理照单人 SingleRig 同款（全程锁定；出口=按住 CTRL / 打开面板类 UI；ESC 强退后
// 任意键/点画布静默回锁；锁定首帧 movement 尖峰吞掉）。触屏不挂本组件（走 ExecutionPanel 按钮）。
// 准心三态经 gameStore.walkAim 词表广播（复用单人准心通道）：
//   'exec:<pid>' = 瞄着可处决的破产目标（张开）｜ 'deny:living'/'deny:poor' = 活人/赔不起（斜叉）
//   ｜ null = 空处（闭合，可开枪赦免）。
// useFrame 内逐帧改写 camera 位姿是 r3f 既定用法（与 CameraRig/SingleRig 同款豁免）。
/* eslint-disable react-hooks/immutability */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import { rayHitsBox } from './aim';
import { T } from '../text';

const _dir = new THREE.Vector3(); // 每帧视线方向临时向量（零分配）

// 三态判定：多人座位在 rotation=[0,rot,0] 组内 → 包围盒中心须转到世界系再与视线求交。
// 排除行刑者自己与观战者；命中破产目标=exec、命中其他人（活人或不可处决者）=deny:living；
// 无命中时付不起=deny:poor（对空也是叉）、付得起=null（闭合，可赦免）。
function classifyAim(camera, state, players, seats, rot, playerId) {
  const ex = state?.execution;
  if (!ex?.targetId) return null;
  const fwd = camera.getWorldDirection(_dir);
  const cr = Math.cos(rot), sr = Math.sin(rot);
  let best = null;
  (players ?? []).forEach((p, i) => {
    if (p.id === playerId || p.spectator) return;
    const s = seats?.[i];
    if (!s) return;
    const wx = s.x * cr + s.z * sr, wz = -s.x * sr + s.z * cr;
    const t = rayHitsBox(camera.position, fwd, wx, wz, 0.15, 2.05, 0.5, 0.5);
    if (t < 15 && (!best || t < best.t)) best = { p, t };
  });
  if (!best) return state.me?.canPardon ? null : 'deny:poor';
  return best.p.id === ex.targetId ? `exec:${best.p.id}` : 'deny:living';
}

export default function ExecutionRig({ players, seats, rot, camZ, eyeY, playerId }) {
  const { camera, gl } = useThree();
  const yaw = useRef(0);
  const pitch = useRef(-0.12);

  // 挂载即从当前相机朝向接管（CameraRig 正注视桌心，反解 yaw/pitch → 零跳变）。
  useEffect(() => {
    camera.getWorldDirection(_dir);
    yaw.current = Math.atan2(-_dir.x, -_dir.z);
    pitch.current = Math.asin(THREE.MathUtils.clamp(_dir.y, -1, 1));
  }, [camera]);

  useEffect(() => {
    const canvas = gl.domElement;
    const ctrl = { held: false };
    const spike = { skip: false };
    const requestLock = () => { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* 忽略 */ } };
    const isLocked = () => document.pointerLockElement === canvas;
    const shouldLock = () => !ctrl.held && !useGameStore.getState().panel;
    const sync = () => {
      if (shouldLock()) { if (!isLocked()) requestLock(); }
      else if (isLocked()) document.exitPointerLock();
    };
    const typingNow = () => {
      const el = document.activeElement;
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const onLockChange = () => {
      if (isLocked()) spike.skip = true; // 吞掉锁定后首帧位移尖峰
      useGameStore.getState().setWalkLocked(isLocked());
    };
    const onMove = (e) => {
      if (!isLocked()) return;
      if (spike.skip) { spike.skip = false; return; }
      if (Math.abs(e.movementX) > 200 || Math.abs(e.movementY) > 200) return; // 尖峰钳制
      yaw.current -= e.movementX * 0.0026;
      pitch.current = THREE.MathUtils.clamp(pitch.current - e.movementY * 0.0022, -0.85, 0.6);
    };
    const onDown = (e) => {
      if (!isLocked()) { if (e.target === canvas) sync(); return; } // 点画布=静默回锁
      if (e.button !== 0) return;
      const st = useGameStore.getState();
      const aim = st.walkAim;
      if (typeof aim === 'string' && aim.startsWith('exec:')) st.send({ type: 'execute' });
      else if (aim === 'deny:living') st.localSys(T.execution.denyLiving, { key: 'exec-deny', refresh: true });
      else if (aim === 'deny:poor') st.localSys(T.execution.denyPoor(st.state?.me?.pardonCost ?? 0), { key: 'exec-deny', refresh: true });
      else st.send({ type: 'pardon' }); // 对空鸣枪=赦免（服务端复核付得起）
    };
    const onKeyDown = (e) => {
      if (e.key === 'Control') { ctrl.held = true; if (isLocked()) document.exitPointerLock(); return; }
      if (typingNow()) return;
      if (!isLocked()) sync(); // ESC 强退后任意键静默回锁
    };
    const onKeyUp = (e) => { if (e.key === 'Control') { ctrl.held = false; sync(); } };
    // panel 开合即时同步（开面板=放开鼠标点按钮，关掉回锁）
    let prevPanel = useGameStore.getState().panel;
    const unsub = useGameStore.subscribe((s) => { if (s.panel !== prevPanel) { prevPanel = s.panel; sync(); } });
    document.addEventListener('pointerlockchange', onLockChange);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    sync();
    return () => {
      unsub();
      document.removeEventListener('pointerlockchange', onLockChange);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (isLocked()) document.exitPointerLock();
      const st = useGameStore.getState();
      st.setWalkLocked(false);
      st.setWalkAim(null);
    };
  }, [gl, camera]);

  useFrame(() => {
    camera.position.set(0, eyeY, camZ); // 行刑者不离座：定点自由环视
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch.current, yaw.current, 0);
    const gs = useGameStore.getState();
    const aim = gs.walkLocked ? classifyAim(camera, gs.state, players, seats, rot, playerId) : null;
    gs.setWalkAim(aim);
    // E2E 探针（__walkRig 先例）：headless 拿不到指针锁，靠它断言 yaw/pitch/aim 判定
    if (import.meta.env.DEV && typeof window !== 'undefined') window.__execRig = { locked: gs.walkLocked, aim, yaw: yaw.current, pitch: pitch.current };
  });

  return null;
}
