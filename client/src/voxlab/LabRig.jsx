// VoxLab 行走 rig:复刻单人模式 SingleRig 的 walk 态(Scene3D.jsx §9.6)——
// 指针锁定 + 中央准心、WASD 惯性(加速快/滑停慢)、步伐颠簸 + 横移侧倾、碰撞软推出。
// 隔离区差异:全屋可走(无阵营半场夹紧)、准心路由=摆放/删除素材(不发任何 WS 消息)。
// 可放置面:地面 / 桌面(y=1.0,毡区) / 横梁顶(y=6.2) / 天花板(y=10,悬挂=顶部吸附)。
// 摆放变换:Q/E 旋转(±15°,按住连转)、滚轮缩放(0.2×~5×)、R 换笔刷;虚影(Stage#GhostPreview)实时预览。
// 保留原版三条硬规则:①锁定后首帧 mousemove 尖峰吞掉+ >200px 钳制;②CTRL 按住放锁、
// 松开回锁,ESC 退锁后任意按键/点画布静默回锁;③监听器只挂一次,活值经 ref 读。
/* eslint-disable react-hooks/immutability */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SINGLE_TEAM_SEATS } from '../scene/singleLayout';
import { useLabStore, aimLive, placeTransform } from './labStore';

const WALK_EYE = 2.35, WALK_SPEED = 3.6;
const BOUND = 10.6;                       // 全屋走动界(墙在 ±12,留身位)
const _dir = new THREE.Vector3();

// 场景碰撞体(对位 Stage 的单人长桌造景;全屋开放,比单人模式多出 Boss 侧/壁炉/后墙摆设的碰撞)
const BOXES = [
  { x0: -4.8, x1: 4.8, z0: -2.5, z1: 2.5 },                        // 长桌桌体(框 ±4.5/±2.2 + 身位)
  ...SINGLE_TEAM_SEATS.map(({ x }) => ({ x0: x - 0.56, x1: x + 0.56, z0: 2.1, z1: 3.22 })),      // 队伍椅
  { x0: -0.56, x1: 0.56, z0: -3.22, z1: -2.1 },                    // Boss 椅
  { x0: -8.0, x1: -6.7, z0: 7.35, z1: 8.65 },                      // 前左角木箱
  { x0: -9.4, x1: -7.3, z0: -11.2, z1: -9.6 },                     // 后左角木箱堆
  { x0: -1.9, x1: 1.9, z0: -12.0, z1: -10.6 },                     // 壁炉石台
];
const CIRCLES = [
  { cx: 8.3, cz: 6.8, r: 1.05 },   // 前右角小圆桌
  { cx: 7.25, cz: 5.85, r: 0.6 },  // 圆桌双椅
  { cx: 9.3, cz: 7.75, r: 0.6 },
  { cx: -8.6, cz: 7.2, r: 0.88 },  // 前左角酒桶
  { cx: -9, cz: -8, r: 0.85 },     // 沿墙酒桶 ×3
  { cx: -10, cz: -4, r: 0.85 },
  { cx: 9.5, cz: -7, r: 0.85 },
];
function clampWalk(p) {
  p.x = THREE.MathUtils.clamp(p.x, -BOUND, BOUND);
  p.z = THREE.MathUtils.clamp(p.z, -BOUND, BOUND);
  for (let pass = 0; pass < 2; pass++) {
    for (const b of BOXES) {
      if (p.x <= b.x0 || p.x >= b.x1 || p.z <= b.z0 || p.z >= b.z1) continue;
      const dx = Math.min(p.x - b.x0, b.x1 - p.x);
      const dz = Math.min(p.z - b.z0, b.z1 - p.z);
      if (dx < dz) p.x = (p.x - b.x0 < b.x1 - p.x) ? b.x0 : b.x1;
      else p.z = (p.z - b.z0 < b.z1 - p.z) ? b.z0 : b.z1;
    }
    for (const c of CIRCLES) {
      const dx = p.x - c.cx, dz = p.z - c.cz;
      const d = Math.hypot(dx, dz);
      if (d >= c.r || d === 0) continue;
      p.x = c.cx + (dx / d) * c.r;
      p.z = c.cz + (dz / d) * c.r;
    }
  }
  p.x = THREE.MathUtils.clamp(p.x, -BOUND, BOUND);
  p.z = THREE.MathUtils.clamp(p.z, -BOUND, BOUND);
}

// 射线 ∩ 轴对齐盒(slab 法;同 Scene3D#rayHitsBox,y 界改为显式 y0/y1)
function rayHitsBox(origin, dir, cx, cz, y0, y1, hx, hz) {
  let tmin = 0, tmax = 30;
  const axes = [
    [origin.x, dir.x, cx - hx, cx + hx],
    [origin.y, dir.y, y0, y1],
    [origin.z, dir.z, cz - hz, cz + hz],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return Infinity; continue; }
    let t0 = (lo - o) / d, t1 = (hi - o) / d;
    if (t0 > t1) { const tt = t0; t0 = t1; t1 = tt; }
    tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

// 横梁(对位 Room:y 中心 6、截面 0.4、z ∈ {-9,-3,3,9},通长 ±12)
const BEAM_ZS = [-9, -3, 3, 9];

// 准心目标:优先摆放物包围盒(缩放后的实际范围,可删),其次最近的可放置面。
// 可放置面统一返回 {kind:'floor', surface, x, y, z}——kind 不细分,HUD 准心张开逻辑不变。
function aimTargetOf(camera, chars) {
  const fwd = camera.getWorldDirection(_dir);
  const o = camera.position;
  let best = null;
  for (const c of chars) {
    const sc = c.scale ?? 1;
    const t = rayHitsBox(o, fwd, c.x, c.z, c.y ?? 0, (c.y ?? 0) + (c.hy ?? 2.15) * sc, (c.hx ?? 0.45) * sc, (c.hx ?? 0.45) * sc);
    if (t < 12 && (!best || t < best.t)) best = { c, t };
  }
  if (best) return { kind: 'char', id: best.c.id };

  const hits = [];
  const plane = (y, surface, lim, cond) => {
    if (Math.abs(fwd.y) < 1e-6) return;
    const t = (y - o.y) / fwd.y;
    if (t < 0.5 || t > 16) return;
    const x = o.x + fwd.x * t, z = o.z + fwd.z * t;
    if (Math.abs(x) > lim || Math.abs(z) > lim) return;
    if (cond && !cond(x, z)) return;
    hits.push({ t, x, y, z, surface });
  };
  if (fwd.y < 0) {
    plane(0, 'floor', BOUND);
    if (o.y > 1.0) plane(1.0, 'table', 12, (x, z) => Math.abs(x) <= 4.5 && Math.abs(z) <= 2.2); // 长桌毡面+框
  } else {
    plane(10, 'ceiling', 11.6);
  }
  for (const bz of BEAM_ZS) {
    const t = rayHitsBox(o, fwd, 0, bz, 5.8, 6.2, 12, 0.2);
    if (t < 16) hits.push({ t, x: o.x + fwd.x * t, y: 6.2, z: bz, surface: 'beam' }); // 顶面+中线吸附
  }
  if (!hits.length) return null;
  const h = hits.reduce((a, b) => (a.t < b.t ? a : b));
  return { kind: 'floor', surface: h.surface, x: h.x, y: h.y, z: h.z };
}

export default function LabRig() {
  const { camera, gl } = useThree();
  const pos = useRef(new THREE.Vector3(0, WALK_EYE, 7.6));
  const vel = useRef({ x: 0, z: 0 });
  const smSpeed = useRef(0);
  const yaw = useRef(0);          // yaw=0 面向 -z(桌心)
  const pitch = useRef(-0.14);
  const roll = useRef(0);
  const bob = useRef(0);
  const keys = useRef({});

  // WASD(输入框让路;窗口失焦清空按键防"卡键漂移")
  useEffect(() => {
    const typing = () => {
      const el = document.activeElement;
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    };
    const down = (e) => { if (!typing()) keys.current[e.code] = true; };
    const up = (e) => { keys.current[e.code] = false; };
    const blur = () => { keys.current = {}; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // 指针锁 + 准心路由(监听器只挂一次;活值经 getState/aimLive 读)
  useEffect(() => {
    const canvas = gl.domElement;
    const ctrl = { held: false };
    const requestLock = () => { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* 浏览器拒绝忽略 */ } };
    const isLocked = () => document.pointerLockElement === canvas;
    const spike = { skip: false };
    const onLockChange = () => {
      if (isLocked()) spike.skip = true;
      useLabStore.getState().setLocked(isLocked());
    };
    const onMove = (e) => {
      if (!isLocked()) return;
      if (spike.skip) { spike.skip = false; return; }
      if (Math.abs(e.movementX) > 200 || Math.abs(e.movementY) > 200) return;
      yaw.current -= e.movementX * 0.0026;
      pitch.current = THREE.MathUtils.clamp(pitch.current - e.movementY * 0.0022, -0.9, 0.7);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Control') { ctrl.held = true; if (isLocked()) document.exitPointerLock(); return; }
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      const st = useLabStore.getState();
      // 功能键(锁定与否都生效;Q/E 吃键盘自动重复=按住连转)
      if (e.code === 'KeyV') st.toggleSwap('chandelier');
      else if (e.code === 'KeyB') st.toggleSwap('table');
      else if (e.code === 'KeyN') st.toggleSwap('chairs');
      else if (e.code === 'KeyM') st.toggleSwap('room');
      else if (e.code === 'KeyF') st.toggleSwap('fireplace');
      else if (e.code === 'KeyG') st.toggleSwap('barrels');
      else if (e.code === 'KeyT') st.toggleSwap('decor');
      else if (e.code === 'KeyP') st.toggleSwap('players');
      else if (e.code === 'KeyH') st.toggleHelp();
      else if (e.code === 'KeyR') st.cycleBrush(e.shiftKey ? -1 : 1);
      else if (e.code === 'KeyX') st.clearChars();
      else if (e.code === 'KeyQ') st.rotGhost(Math.PI / 12);
      else if (e.code === 'KeyE') st.rotGhost(-Math.PI / 12);
      if (!isLocked() && !ctrl.held) requestLock();     // ESC 退锁后任意按键静默回锁
    };
    const onKeyUp = (e) => { if (e.key === 'Control') { ctrl.held = false; requestLock(); } };
    const onDown = (e) => {
      if (!isLocked()) { if (e.target === canvas) requestLock(); return; }
      const st = useLabStore.getState();
      const aim = aimLive.current;
      if (!aim) return;
      if (e.button === 0 && aim.kind === 'floor') {
        const p = placeTransform(camera, aim, st);
        st.placeBrush(p.x, p.y, p.z, p.ry);
      } else if (e.button === 2 && aim.kind === 'char') {
        st.removeChar(aim.id);
      }
    };
    const onWheel = (e) => {
      if (!isLocked()) return;
      // 滚轮=缩放(换笔刷在 R);按 delta 比例——一格鼠标(±120)=×1.1,触控板小步平滑
      useLabStore.getState().scaleGhost(Math.pow(1.1, -e.deltaY / 120));
    };
    const onCtx = (e) => { if (document.pointerLockElement) e.preventDefault(); };
    document.addEventListener('pointerlockchange', onLockChange);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('wheel', onWheel);
    window.addEventListener('contextmenu', onCtx);
    return () => {
      document.removeEventListener('pointerlockchange', onLockChange);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('contextmenu', onCtx);
      if (isLocked()) document.exitPointerLock();
      useLabStore.getState().setLocked(false);
    };
  }, [gl, camera]);

  useFrame((st, delta) => {
    // Teardown 手感:目标速度 + 指数趋近惯性 + 碰撞软推出(法向吸收/切向保留) + 步伐颠簸
    const dt = Math.min(delta, 0.05);
    const k = keys.current;
    const f = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    const r = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    const sy = Math.sin(yaw.current), cy = Math.cos(yaw.current);
    let tx = 0, tz = 0;
    if (f || r) {
      const n = f && r ? Math.SQRT1_2 : 1;
      tx = (-sy * f + cy * r) * n * WALK_SPEED;
      tz = (-cy * f - sy * r) * n * WALK_SPEED;
    }
    const kAcc = 1 - Math.exp(-(f || r ? 9 : 6.5) * dt);
    vel.current.x += (tx - vel.current.x) * kAcc;
    vel.current.z += (tz - vel.current.z) * kAcc;
    const px = pos.current.x + vel.current.x * dt;
    const pz = pos.current.z + vel.current.z * dt;
    pos.current.x = px; pos.current.z = pz;
    clampWalk(pos.current);
    const cxn = pos.current.x - px, czn = pos.current.z - pz;
    const cl = Math.hypot(cxn, czn);
    if (cl > 1e-6) {
      const soft = Math.min(1, 20 * dt);
      pos.current.x = px + cxn * soft;
      pos.current.z = pz + czn * soft;
      const nnx = cxn / cl, nnz = czn / cl;
      const vn = vel.current.x * nnx + vel.current.z * nnz;
      if (vn < 0) { vel.current.x -= nnx * vn; vel.current.z -= nnz * vn; }
    }
    const rawSpeed = Math.hypot(vel.current.x, vel.current.z);
    smSpeed.current += (rawSpeed - smSpeed.current) * Math.min(1, 9 * dt);
    const speed = smSpeed.current;
    const sf = Math.min(1, speed / WALK_SPEED);
    bob.current += speed * dt * 3.1;
    const bobY = Math.sin(bob.current * 2) * 0.017 * sf;
    const bobS = Math.sin(bob.current) * 0.012 * sf;
    const rollTarget = -r * 0.014 * sf + Math.sin(bob.current) * 0.006 * sf;
    roll.current += (rollTarget - roll.current) * Math.min(1, 10 * dt);
    camera.position.set(
      pos.current.x + cy * bobS,
      WALK_EYE + bobY,
      pos.current.z - sy * bobS,
    );
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch.current, yaw.current, roll.current);
    // 准心:精确坐标进 aimLive(逐帧),类型进 store(变化才写,喂 HUD 准心张开)
    const labSt = useLabStore.getState();
    const aim = labSt.locked ? aimTargetOf(camera, labSt.chars) : null;
    aimLive.current = aim;
    labSt.setAimKind(aim?.kind ?? null);
    // 自动化探针(同 __walkRig 先例)
    if (import.meta.env.DEV) {
      window.__voxlab = {
        locked: labSt.locked, aim, yaw: yaw.current, pitch: pitch.current,
        pos: [pos.current.x, pos.current.z], chars: labSt.chars.length, swaps: labSt.swaps,
        role: labSt.brush, imports: labSt.imports.length,
        ghostRot: labSt.ghostRot, ghostScale: labSt.ghostScale,
      };
    }
  });
  return null;
}
