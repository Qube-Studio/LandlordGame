// 招募令半身像静态素材(预渲染;反馈:消灭 3D 画布的渲染空窗、且必须严格正视):
//   ①饰品 = 一次性离屏 WebGLRenderer + 正交相机,把真 3D 头戴道具(headProps 单一真源)渲成正视图;
//   ②身体 = skinCanvas 正面皮肤(与 3D 玩家同一画布),按真实盒体比例(躯干 0.6×0.7 / 臂宽 0.22)拉伸;
// 两者按同一像素密度(~27px/世界单位)拼进 32×40 像素画布,dataURL 按角色缓存——
// 招募令用 <img> 即插即显,零 WebGL 上下文、零透视歪斜。
import * as THREE from 'three';
import { skinCanvas } from '../assets/texlib';
import { buildHeadProp } from './headProps';

const ROLES = ['landlord', 'capitalist', 'farmer', 'investor', 'glutton', 'prosecutor'];
// 正交视窗 x∈[-0.4,0.4] / y∈[-0.08,0.62](罩住最宽的草帽与最高的厨师帽)→ 22×19px
const ACC_W = 22, ACC_H = 19;

let ACC = null; // role -> 饰品正视图小画布(懒初始化,一个渲染器扫完全部角色后立即释放)
function renderAccessories() {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(ACC_W, ACC_H);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // 与主场景(r3f 默认)一致,色调不跑偏
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.15));
  const dir = new THREE.DirectionalLight(0xffffff, 0.85);
  dir.position.set(0.6, 1, 2.5);
  scene.add(dir);
  const cam = new THREE.OrthographicCamera(-0.4, 0.4, 0.62, -0.08, 0.1, 10);
  cam.position.set(0, 0, 3);
  const out = {};
  for (const role of ROLES) {
    const prop = buildHeadProp(role);
    if (!prop) continue;
    scene.add(prop);
    renderer.render(scene, cam);
    const c = document.createElement('canvas');
    c.width = ACC_W; c.height = ACC_H;
    c.getContext('2d').drawImage(renderer.domElement, 0, 0);
    out[role] = c;
    scene.remove(prop);
  }
  renderer.dispose();
  return out;
}

const CACHE = new Map();
export function bustUrl(role = 'none') {
  if (CACHE.has(role)) return CACHE.get(role);
  if (!ACC) ACC = renderAccessories();
  const c = document.createElement('canvas');
  c.width = 32; c.height = 40;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const body = skinCanvas({ role, part: 'body', face: 'front' });
  const arm = skinCanvas({ role, part: 'arm', face: 'front' });
  ctx.drawImage(arm, 0, 0, 16, 16, 2, 21, 6, 19);    // 左臂(0.22 世界宽 → 6px)
  ctx.drawImage(body, 0, 0, 16, 16, 8, 21, 16, 19);  // 躯干(0.6×0.7 → 16×19,真实比例)
  ctx.drawImage(arm, 0, 0, 16, 16, 24, 21, 6, 19);   // 右臂
  if (ACC[role]) ctx.drawImage(ACC[role], 5, 0);     // 头位浮空饰品(正视图,与肩留 2px 悬浮)
  const url = c.toDataURL();
  CACHE.set(role, url);
  return url;
}
