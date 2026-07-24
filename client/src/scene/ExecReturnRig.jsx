// 处决相机归位段（§3.9 批次2修订）：处决窗的任何相机接管（行刑者软锁/旁观运镜/连发第三人称/
// 焦点目标软锁）结束后，从当前位姿 smootherstep 0.9s 混回**落座中性位**（恰为 CameraRig lookAt
// 初值）再交还——之前是直接卸载，被反馈「从锁定视角回来没有镜头过渡」。
// useFrame 内逐帧改写 camera 位姿/fov 是 r3f 既定用法（与 CineRig 同款豁免）。
/* eslint-disable react-hooks/immutability */
import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { aimAngles, lerpAngle, smootherstep } from './aim';

const BASE_FOV = 58;
const DUR = 0.9;
const _dir = new THREE.Vector3();

export default function ExecReturnRig({ camZ, eyeY, lookY, onDone }) {
  const { camera } = useThree();
  const rig = useMemo(() => ({ t: 0, from: null, done: false }), []);

  useEffect(() => () => { camera.fov = BASE_FOV; camera.updateProjectionMatrix(); }, [camera]);

  useFrame((st, delta) => {
    if (rig.done) return;
    if (!rig.from) {
      camera.getWorldDirection(_dir);
      rig.from = {
        yaw: Math.atan2(-_dir.x, -_dir.z),
        pitch: Math.asin(THREE.MathUtils.clamp(_dir.y, -1, 1)),
        px: camera.position.x, py: camera.position.y, pz: camera.position.z,
        fov: camera.fov,
      };
    }
    rig.t += delta;
    const u = smootherstep(rig.t / DUR);
    const to = aimAngles({ x: 0, y: eyeY, z: camZ }, 0, lookY, 0); // 中性位朝向（看桌心）
    const f = rig.from;
    camera.position.set(f.px + (0 - f.px) * u, f.py + (eyeY - f.py) * u, f.pz + (camZ - f.pz) * u);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(f.pitch + (to.pitch - f.pitch) * u, lerpAngle(f.yaw, to.yaw, u), 0);
    camera.fov = f.fov + (BASE_FOV - f.fov) * u;
    camera.updateProjectionMatrix();
    if (u >= 1) {
      rig.done = true;
      onDone?.();
    }
  });

  return null;
}
