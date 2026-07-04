// 重力枪式携带（3D 直接操作共用，HandLayer 下注拖拽 / PayoutLayer 协商拖拽）：
// 指针射线打到桌面平面得到悬浮目标点，携带物用弹簧-阻尼追踪（带一点滞后与回弹），
// 消费方再按速度给牌加倾斜——「抓着东西甩」的手感来源。
import * as THREE from 'three';
import { TABLE_TOP } from './cards';

const _dir = new THREE.Vector3();

// 指针(NDC {x,y}) → 桌面上方的悬浮目标点（世界系，写入 out 并返回）。
// 视线朝上打不到桌面时退化为沿视线固定距离；结果夹回毡面范围。
export function groundFromPointer(camera, ndc, out) {
  _dir.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position).normalize();
  let t = _dir.y < -0.02 ? (TABLE_TOP - camera.position.y) / _dir.y : 3.2;
  t = Math.min(Math.max(t, 0.4), 12);
  out.copy(camera.position).addScaledVector(_dir, t);
  out.x = THREE.MathUtils.clamp(out.x, -2.9, 2.9);
  out.z = THREE.MathUtils.clamp(out.z, -1.95, 1.95);
  out.y = TABLE_TOP;
  return out;
}

// 弹簧-阻尼追踪：pos 每帧向 target 收敛，vel 供倾斜用。
export class CarrySpring {
  constructor(startPos) {
    this.pos = startPos.clone();
    this.vel = new THREE.Vector3();
  }
  update(target, dt) {
    const d = Math.min(dt, 0.05); // 掉帧时限步，避免弹簧爆炸
    const K = 46, C = 10.5;       // 刚度/阻尼：略欠阻尼 → 轻微回弹
    this.vel.x += ((target.x - this.pos.x) * K - this.vel.x * C) * d;
    this.vel.y += ((target.y - this.pos.y) * K - this.vel.y * C) * d;
    this.vel.z += ((target.z - this.pos.z) * K - this.vel.z * C) * d;
    this.pos.addScaledVector(this.vel, d);
    return this.pos;
  }
  // 随速度倾斜（写入 mesh.rotation；x 前后倾、z 左右倾）
  tilt(rotation) {
    rotation.set(
      THREE.MathUtils.clamp(this.vel.z * 0.11, -0.55, 0.55),
      0,
      THREE.MathUtils.clamp(-this.vel.x * 0.11, -0.55, 0.55),
    );
  }
}
