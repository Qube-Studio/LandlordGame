// 处决窗电影运镜（§3.9 批次2，纯表现层）：非行刑者的相机接管。三种模式：
//   watcher（A·旁观者）——视角全接管：首轮先看破产者（多人=中间点；中间点贴近自己=巡视序列：
//     焦点→瞥行刑者→逐个其余→回行刑者），快速甩到行刑者并微推近（他已持枪），带紧张呼吸/
//     手持抖动等开枪；开枪即刻甩到焦点看生死（结果窗）；后续焦点=看行刑者一眼→切新焦点→等判决。
//   target（B·焦点破产者）——软锁在行刑者身上：可操控（读全局 look）但偏移锥极小出不去；
//     头部动作照常广播（useHeadReport 读同一 look）。开枪后的黑屏红/白字由 UI 罩层（ExecOverlay）负责。
//   volley（超时连发）——全员（含行刑者）锁定同一第三人称中景：侧前 45° 看行刑者连续开枪。
// 挂载=接管相机，卸载=交还 CameraRig（其阻尼 lerp 自动柔和追平）。REDUCED/触屏 watcher 不锁（见 Scene3D 分派）。
// useFrame 内逐帧改写 camera 位姿/fov 是 r3f 既定用法（与 CineRig 同款豁免）。
/* eslint-disable react-hooks/immutability */
import { useMemo, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import { IS_TOUCH } from '../game/inputMode';
import { seatWorld, aimAngles, lerpAngle, smootherstep } from './aim';

const BASE_FOV = 58;
const damp = (k, dt) => 1 - Math.pow(k, dt); // 指数阻尼（帧率无关，稳态微跟随用）
// 转场（批次2修订）：所有大幅转头走 smootherstep tween（缓入缓出），不再用指数 damp
// （damp=起步猛收尾拖，被反馈「生硬缺加减速」）。稳态期只柔和跟随呼吸/目标微移。

export default function ExecCineRig({ mode, players, seats, rot, camZ, eyeY, playerId, look }) {
  const { camera, gl } = useThree();
  // 焦点目标（B）的软锁偏移：指针锁下用 movement 增量累积（绝对 look 在锁定态不更新）；
  // 触屏无指针锁，回落读全局 look（拖动增量路径）。
  const lockOff = useRef({ x: 0, y: 0 });

  // 指针锁（批次2修订）：旁观者/焦点破产者被运镜接管期间鼠标同样锁定（沉浸+防误点）——
  // 之前只有行刑者锁，被反馈 A/B「没被锁鼠标」。管理逻辑照 ExecutionRig 精简（无开枪消费）。
  useEffect(() => {
    if (IS_TOUCH) return undefined;
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
    const onLockChange = () => { if (isLocked()) spike.skip = true; };
    const onMove = (e) => {
      if (!isLocked()) return;
      if (spike.skip) { spike.skip = false; return; }
      if (Math.abs(e.movementX) > 200 || Math.abs(e.movementY) > 200) return;
      // 仅焦点目标（B）可小范围操控；旁观/连发纯运镜，输入忽略
      lockOff.current.x = THREE.MathUtils.clamp(lockOff.current.x + e.movementX * 0.004, -1, 1);
      lockOff.current.y = THREE.MathUtils.clamp(lockOff.current.y + e.movementY * 0.004, -1, 1);
    };
    const onDown = (e) => { if (!isLocked() && e.target === canvas) sync(); };
    const onKeyDown = (e) => {
      if (e.key === 'Control') { ctrl.held = true; if (isLocked()) document.exitPointerLock(); return; }
      if (typingNow()) return;
      if (!isLocked()) sync();
    };
    const onKeyUp = (e) => { if (e.key === 'Control') { ctrl.held = false; sync(); } };
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
    };
  }, [gl]);

  // 帧间可变状态（render 期不读写）
  const rig = useMemo(() => ({
    t: 0,
    stage: 'intro',      // watcher：intro(看破产者/巡视) → judge(盯行刑者等枪响) → result(看生死)
    stageT: 0,
    tourIdx: 0,          // 巡视序列步进
    lastTargetId: null,
    lastResultId: null,
    lastMode: null,
    yaw: 0, pitch: 0, fov: BASE_FOV,
    tween: null,         // {fromYaw, fromPitch, fromFov, t, dur}：大转场的 smootherstep 快照
    inited: false,
  }), []);

  useEffect(() => () => { camera.fov = BASE_FOV; camera.updateProjectionMatrix(); }, [camera]);

  useFrame((st, delta) => {
    const gs = useGameStore.getState();
    const state = gs.state;
    const ex = state?.execution;
    if (!ex) return;
    rig.t += delta;
    rig.stageT += delta;

    // ---- 世界坐标索引 ----
    const posOf = (pid) => {
      const i = (players ?? []).findIndex(p => p.id === pid);
      const s = i >= 0 ? seats?.[i] : null;
      return s ? seatWorld(s, rot) : { x: 0, z: 0 };
    };
    const cam = { x: 0, y: eyeY, z: camZ };
    const HEAD_Y = 1.55; // 看人=看胸口偏上（坐姿头部约 1.7，取略低使构图含上身）

    const startTween = (dur) => { rig.tween = { fromYaw: rig.yaw, fromPitch: rig.pitch, fromFov: rig.fov, t: 0, dur }; };

    // 首帧：从当前相机朝向接管，tween 到首个目标（平滑入场零跳变）
    if (!rig.inited) {
      rig.inited = true;
      camera.getWorldDirection(_dir);
      rig.yaw = Math.atan2(-_dir.x, -_dir.z);
      rig.pitch = Math.asin(THREE.MathUtils.clamp(_dir.y, -1, 1));
      rig.fov = camera.fov;
      rig.lastTargetId = ex.targetId;
      rig.lastMode = mode;
      startTween(0.9);
    }
    // 模式切换（如进入连发第三人称）：转场平滑
    if (mode !== rig.lastMode) { rig.lastMode = mode; startTween(0.7); }
    // 非 watcher 模式的焦点切换（连发逐个换目标/软锁换行刑者）：同样走转场曲线
    if (mode !== 'watcher' && ex.targetId && ex.targetId !== rig.lastTargetId) {
      rig.lastTargetId = ex.targetId;
      startTween(0.5);
    }

    // ---- 事件驱动的阶段切换（watcher）----
    if (mode === 'watcher') {
      // 开枪打断一切：lastResult 出现（且是新的一笔——广播对象引用会变，须用稳定键判重）→ 立即切去看生死
      const lr = ex.lastResult;
      const lrKey = lr ? `${lr.targetId}:${lr.outcome}:${ex.results?.length ?? 0}` : null;
      if (lrKey && lrKey !== rig.lastResultId && rig.stage !== 'result') {
        rig.lastResultId = lrKey;
        rig.stage = 'result';
        rig.stageT = 0;
        startTween(0.55); // 快甩看生死——快但带缓入缓出
      }
      // 新焦点开始（targetId 变化且非空）：开窗首帧走完整 intro；后续焦点=瞥行刑者→切新焦点→盯行刑者
      if (ex.targetId && ex.targetId !== rig.lastTargetId) {
        rig.lastTargetId = ex.targetId;
        rig.stage = rig.t < 0.2 ? 'intro' : 'briefJudge';
        rig.stageT = 0;
        rig.tourIdx = 0;
        startTween(0.8);
      }
    }

    // ---- 每帧目标角（各模式算 want{yaw,pitch,fov} + 逼近速率 k：越小逼近越快）----
    let want;
    let k;
    if (mode === 'volley' || ex.volley) {
      // 连发第三人称：行刑者侧前 45° 中景，看行刑者与当前焦点的中点
      const j = posOf(ex.executionerId ?? ex.lastResult?.executionerId ?? playerId);
      const f = posOf(ex.targetId ?? ex.lastResult?.targetId ?? playerId);
      const mid = { x: (j.x + f.x) / 2, z: (j.z + f.z) / 2 };
      // 机位：行刑者旁侧偏焦点方向 45°、半径 1.7、高 1.55（世界系定点，全员一致）
      const az = Math.atan2(f.x - j.x, f.z - j.z) + 0.8;
      const cx = j.x + Math.sin(az) * 1.7, cz = j.z + Math.cos(az) * 1.7;
      camera.position.set(cx, 1.55, cz);
      const a = aimAngles({ x: cx, y: 1.55, z: cz }, mid.x, HEAD_Y, mid.z);
      want = { ...a, fov: 46 };
      k = 0.001;
    } else if (mode === 'target') {
      // B·软锁行刑者：基准角=看行刑者，输入只允许 ±0.2/±0.12 rad 的小偏移。
      // 桌面=指针锁 movement 增量（lockOff）；触屏无锁回落全局 look（拖动增量）。
      camera.position.set(cam.x, cam.y, cam.z);
      const j = posOf(ex.executionerId);
      const a = aimAngles(cam, j.x, HEAD_Y, j.z);
      const src = IS_TOUCH ? (look?.current ?? { x: 0, y: 0 }) : lockOff.current;
      const lx = THREE.MathUtils.clamp(src.x, -1, 1);
      const ly = THREE.MathUtils.clamp(src.y, -1, 1);
      want = { yaw: a.yaw - lx * 0.2, pitch: a.pitch - ly * 0.12, fov: 52 };
      k = 0.005;
    } else {
      // A·watcher 运镜
      camera.position.set(cam.x, cam.y, cam.z);
      const focus = posOf(ex.targetId ?? ex.lastResult?.targetId);
      const judge = posOf(ex.executionerId ?? ex.lastResult?.executionerId);
      k = 0.02; // watcher 稳态：柔和跟随（大转场全部由 tween 承担）
      if (rig.stage === 'intro') {
        // 首轮开场：多人=看破产者中间点；中间点贴近自己=巡视序列
        const qs = (ex.queue ?? []).filter(id => id !== playerId);
        const pts = qs.map(posOf);
        const mid = pts.length
          ? { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length }
          : focus;
        const midNearMe = Math.hypot(mid.x - cam.x, mid.z - cam.z) < 1.2;
        if (pts.length > 1 && midNearMe) {
          // 巡视：焦点→行刑者→其余破产者逐个→行刑者（每步 0.9s，步进带转场曲线）
          const tour = [focus, judge, ...qs.filter(id => id !== ex.targetId).map(posOf), judge];
          const idx = Math.min(tour.length - 1, Math.floor(rig.stageT / 0.9));
          if (idx !== rig.tourIdx) { rig.tourIdx = idx; startTween(0.6); }
          const p = tour[idx];
          want = { ...aimAngles(cam, p.x, HEAD_Y, p.z), fov: 54 };
          if (rig.stageT > tour.length * 0.9) { rig.stage = 'judge'; rig.stageT = 0; startTween(0.75); }
        } else {
          want = { ...aimAngles(cam, mid.x, HEAD_Y, mid.z), fov: 54 };
          if (rig.stageT > 1.5) { rig.stage = 'judge'; rig.stageT = 0; startTween(0.75); }
        }
      } else if (rig.stage === 'briefJudge') {
        // 后续焦点：先瞥一眼行刑者
        want = { ...aimAngles(cam, judge.x, HEAD_Y, judge.z), fov: 50 };
        if (rig.stageT > 0.8) { rig.stage = 'briefFocus'; rig.stageT = 0; startTween(0.7); }
      } else if (rig.stage === 'briefFocus') {
        // 再切到新焦点
        want = { ...aimAngles(cam, focus.x, HEAD_Y, focus.z), fov: 52 };
        if (rig.stageT > 0.9) { rig.stage = 'judge'; rig.stageT = 0; startTween(0.7); }
      } else if (rig.stage === 'result') {
        // 开枪：甩到焦点看生死（tween 已在事件处启动；结果窗 3s，targetId 变化带走阶段）
        want = { ...aimAngles(cam, focus.x, HEAD_Y, focus.z), fov: 48 };
      } else {
        // judge：盯行刑者+微推近（fov 缩），等开枪
        want = { ...aimAngles(cam, judge.x, HEAD_Y, judge.z), fov: 47 };
      }
      // 紧张呼吸/手持抖动（watcher 专属；判决时刻收敛一点）
      const amp = rig.stage === 'result' ? 0.002 : 0.0045;
      want.yaw += (Math.sin(rig.t * 1.7) + 0.5 * Math.sin(rig.t * 3.9 + 1.2)) * amp;
      want.pitch += (Math.cos(rig.t * 2.3 + 0.6) + 0.4 * Math.sin(rig.t * 5.1)) * amp * 0.7
        + Math.sin(rig.t * 0.9) * 0.0035; // 慢呼吸起伏
      want.fov += Math.sin(rig.t * 0.9 + 1) * 0.35;
    }

    // ---- 应用：大转场=smootherstep tween（缓入缓出）；稳态=柔和 damp 跟随（呼吸/目标微移）----
    if (rig.tween) {
      rig.tween.t += delta;
      const u = smootherstep(rig.tween.t / rig.tween.dur);
      rig.yaw = lerpAngle(rig.tween.fromYaw, want.yaw, u);
      rig.pitch = rig.tween.fromPitch + (want.pitch - rig.tween.fromPitch) * u;
      rig.fov = rig.tween.fromFov + (want.fov - rig.tween.fromFov) * u;
      if (u >= 1) rig.tween = null;
    } else {
      const dk = damp(k, delta);
      rig.yaw = lerpAngle(rig.yaw, want.yaw, dk);
      rig.pitch += (want.pitch - rig.pitch) * dk;
      rig.fov += (want.fov - rig.fov) * damp(0.02, delta);
    }
    camera.rotation.order = 'YXZ';
    camera.rotation.set(rig.pitch, rig.yaw, 0);
    if (Math.abs(camera.fov - rig.fov) > 0.02) { camera.fov = rig.fov; camera.updateProjectionMatrix(); }
    if (import.meta.env.DEV && typeof window !== 'undefined') window.__execCine = { mode, stage: rig.stage, yaw: rig.yaw, pitch: rig.pitch, fov: rig.fov, volley: !!ex.volley };
  });

  return null;
}

const _dir = new THREE.Vector3();
