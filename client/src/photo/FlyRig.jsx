// 拍照棚相机：6 自由度自由飞行 + 指针锁定鼠标环视 + 一键机位。
//  - 飞行模式：点画布锁鼠标 → 鼠标转视角，WASD 前后左右（**世界水平面**，只按朝向偏航走、不随俯仰下沉；
//    看向地面按 W 仍是水平前进而非扎进桌面）、Space 上升、Shift 下降；滚轮调飞行速度。
//  - 摆放模式：不锁鼠标（腾出鼠标拖坐标轴/点选）；WASD 仍可平移相机取景，只是不环视。
//  - 机位预设：顶视/前/后/左/右/透视——设相机位并按注视桌心反解 yaw/pitch，之后接着自由飞行不跳变。
// 复刻 walk rig 两条硬规则：①锁定后首帧 mousemove 尖峰吞掉；②>200px 位移钳制（SwiftShader/指针锁 bug）。
/* eslint-disable react-hooks/immutability */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { usePhotoStore, liveCamera } from './photoStore';
import { itemRegistry } from './itemRegistry';

const LOOK_AT = new THREE.Vector3(0, 1.0, 0); // 机位预设都注视桌心略上
const PRESETS = {
  persp: [5.6, 4.4, 7.8],
  top: [0.0, 13.0, 0.0001], // 近乎正上方俯视桌面
  front: [0.0, 3.2, 9.0],
  back: [0.0, 3.2, -9.0],
  left: [-9.0, 3.2, 0.0],
  right: [9.0, 3.2, 0.0],
};

const typing = () => {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
};

export default function FlyRig() {
  const { camera, gl } = useThree();
  const pos = useRef(new THREE.Vector3(...PRESETS.persp));
  const yaw = useRef(0);
  const pitch = useRef(0);
  const speed = useRef(5);
  const keys = useRef({});

  // 由 pos → 注视 target，反解 yaw/pitch（yaw=0 面向 -z；fwd=(-sinYaw·cosPitch, sinPitch, -cosYaw·cosPitch)）
  const lookAtPoint = (target) => {
    const d = new THREE.Vector3().subVectors(target, pos.current).normalize();
    pitch.current = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)), -1.535, 1.535);
    yaw.current = Math.atan2(-d.x, -d.z);
  };
  const lookAtTarget = () => lookAtPoint(LOOK_AT);
  const applyPreset = (name) => {
    const p = PRESETS[name]; if (!p) return;
    pos.current.set(p[0], p[1], p[2]);
    lookAtTarget();
  };

  // 初始机位注视桌心
  useEffect(() => { lookAtTarget(); }, []);

  // 消费机位请求（HUD 按钮 / 数字键）
  const preset = usePhotoStore(s => s.preset);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (preset?.name) applyPreset(preset.name); }, [preset]);

  // 消费 F 聚焦请求（§2.1）：dist = radius / tan(fov/2) × 1.2，沿**当前视线**反方向退 dist——
  // 视角朝向不变、只挪机位，聚焦不会让人晕头转向；再 lookAt center 反解一次（消浮点漂移+钳俯仰）。
  const focusReq = usePhotoStore(s => s.focusReq);
  useEffect(() => {
    const f = focusReq; if (!f) return;
    const center = new THREE.Vector3(f.center[0], f.center[1], f.center[2]);
    const dist = f.radius / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.2;
    const cp = Math.cos(pitch.current), sp = Math.sin(pitch.current);
    const cy = Math.cos(yaw.current), sy = Math.sin(yaw.current);
    pos.current.copy(center).addScaledVector(new THREE.Vector3(-sy * cp, sp, -cy * cp), -dist);
    lookAtPoint(center);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusReq]);

  // 消费相机回灌（导入场景时把保存的机位灌回来）
  const camRestore = usePhotoStore(s => s.camRestore);
  useEffect(() => {
    const p = camRestore?.pose; if (!p) return;
    if (Array.isArray(p.pos) && p.pos.length === 3) pos.current.set(p.pos[0], p.pos[1], p.pos[2]);
    if (Number.isFinite(p.yaw)) yaw.current = p.yaw;
    if (Number.isFinite(p.pitch)) pitch.current = p.pitch;
  }, [camRestore]);

  // WASD/Space/Shift（输入框让路；失焦清键防卡键漂移）。Space 阻止翻页。
  useEffect(() => {
    const down = (e) => {
      if (typing()) return;
      keys.current[e.code] = true;
      if (e.code === 'Space' || e.code.startsWith('Shift')) e.preventDefault();
    };
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

  // 指针锁定 + 鼠标环视（监听器只挂一次；活值经 store.getState 读）。
  useEffect(() => {
    const canvas = gl.domElement;
    const isLocked = () => document.pointerLockElement === canvas;
    const requestLock = () => { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* 被拒忽略 */ } };
    const spike = { skip: false };
    const onLockChange = () => { if (isLocked()) spike.skip = true; };
    const onMove = (e) => {
      if (!isLocked()) return;
      if (spike.skip) { spike.skip = false; return; } // 锁定后首帧尖峰吞掉
      if (Math.abs(e.movementX) > 200 || Math.abs(e.movementY) > 200) return;
      yaw.current -= e.movementX * 0.0024;
      pitch.current = THREE.MathUtils.clamp(pitch.current - e.movementY * 0.0022, -1.535, 1.535);
    };
    // 飞行模式点画布=锁鼠标；摆放模式不锁（让 r3f 处理点选/坐标轴拖拽）。
    const onDown = (e) => {
      if (e.target !== canvas) return;
      if (usePhotoStore.getState().mode !== 'fly') return;
      if (!isLocked()) requestLock();
    };
    const onWheel = (e) => {
      if (!isLocked()) return; // 只有锁定飞行时滚轮=调速；否则留给 HUD 滚动
      speed.current = THREE.MathUtils.clamp(speed.current * Math.pow(1.1, -e.deltaY / 120), 0.6, 40);
    };
    document.addEventListener('pointerlockchange', onLockChange);
    window.addEventListener('mousemove', onMove);
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      document.removeEventListener('pointerlockchange', onLockChange);
      window.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('wheel', onWheel);
      if (isLocked()) document.exitPointerLock();
    };
  }, [gl]);

  // 进摆放模式即释放鼠标（腾出坐标轴拖拽）
  const mode = usePhotoStore(s => s.mode);
  useEffect(() => {
    if (mode === 'arrange' && document.pointerLockElement === gl.domElement) document.exitPointerLock();
  }, [mode, gl]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const k = keys.current;
    // WASD 走**世界水平面**：前向只取朝向偏航(忽略俯仰)，右向本就水平——所以 W/S/A/D 不改变高度，
    // 升降只由 Space/Shift 负责(用户要求：前后左右按摄像机相对世界坐标系，而非视角里会随俯仰下沉的前后左右)。
    const cy = Math.cos(yaw.current), sy = Math.sin(yaw.current);
    const fwd = new THREE.Vector3(-sy, 0, -cy);
    const right = new THREE.Vector3(cy, 0, -sy);
    const move = new THREE.Vector3();
    if (k.KeyW) move.add(fwd); if (k.KeyS) move.sub(fwd);
    if (k.KeyD) move.add(right); if (k.KeyA) move.sub(right);
    if (k.Space) move.y += 1; if (k.ShiftLeft || k.ShiftRight) move.y -= 1;
    if (move.lengthSq() > 0) pos.current.addScaledVector(move.normalize(), speed.current * dt);
    camera.position.copy(pos.current);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch.current, yaw.current, 0);
    // 发布实时位姿（导出场景读它）
    liveCamera.pos = [pos.current.x, pos.current.y, pos.current.z];
    liveCamera.yaw = yaw.current; liveCamera.pitch = pitch.current;
    // 自动化探针（同 __walkRig/__voxlab 先例）：E2E/截图读逐帧机位 + 世界点投影到屏幕（找坐标轴像素用）
    if (import.meta.env.DEV) {
      window.__photoRig = { pos: [pos.current.x, pos.current.y, pos.current.z], yaw: yaw.current, pitch: pitch.current, speed: speed.current, keys: Object.keys(keys.current).filter(kk => keys.current[kk]) };
      window.__photoProject = (x, y, z) => {
        const v = new THREE.Vector3(x, y, z).project(camera);
        return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
      };
      // 注册表快照：id → 世界包围盒 + 屏幕 AABB（八角投影包络；hidden 物不在注册表 → 天然不出现）。
      // E2E 点选/框选断言的数据源；覆盖式写 window（硬约束④）。
      window.__photoItems = () => {
        const out = {};
        for (const [id, obj] of itemRegistry) {
          const box = new THREE.Box3().setFromObject(obj);
          if (box.isEmpty()) continue;
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (let i = 0; i < 8; i++) {
            const v = new THREE.Vector3(
              i & 1 ? box.max.x : box.min.x,
              i & 2 ? box.max.y : box.min.y,
              i & 4 ? box.max.z : box.min.z,
            ).project(camera);
            const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
            const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
            if (sx < minX) minX = sx; if (sx > maxX) maxX = sx;
            if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
          }
          out[id] = {
            worldBox3: { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] },
            screenAABB: { minX, minY, maxX, maxY },
          };
        }
        return out;
      };
    }
  });
  return null;
}
