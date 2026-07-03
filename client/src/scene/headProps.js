// 头戴道具(命令式单一真源):3D 玩家(MinecraftPlayer#HeadProp 经 <primitive>)与
// 招募令快照(bustSnapshot 离屏正交渲染)共用同一份几何/材质定义——两处永远同款。
// 坐标为头部局部系(头中心=原点),数值与旧 JSX 版逐值一致。
import * as THREE from 'three';
import { PROP_COLORS } from '../assets/palette';
import { tex } from '../assets/texlib';

const pmat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });
const pmatGlow = (color) => new THREE.MeshStandardMaterial({
  color, roughness: 0.55, metalness: 0.3, flatShading: true, emissive: color, emissiveIntensity: 0.35,
});
const fabricMat = (color) => new THREE.MeshStandardMaterial({
  map: tex('fabric', { color, pattern: 'stripe' }), roughness: 1, flatShading: true,
});
const box = (mat, w, h, d, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
};

export function buildHeadProp(role) {
  const g = new THREE.Group();
  switch (role) {
    case 'landlord': { // 真皇冠:冠圈 + 五尖 + 正面红宝石(金件发光)
      const gold = pmatGlow(PROP_COLORS.crown);
      g.add(box(gold, 0.5, 0.1, 0.5, 0, 0.325, 0));
      [[-0.2, 0.2], [0.2, 0.2], [-0.2, -0.2], [0.2, -0.2], [0, 0]].forEach(([x, z], i) => {
        g.add(box(gold, 0.1, i === 4 ? 0.22 : 0.16, 0.1, x, 0.325 + (i === 4 ? 0.15 : 0.12), z));
      });
      g.add(box(pmat(PROP_COLORS.ruby), 0.1, 0.1, 0.04, 0, 0.345, 0.26));
      return g;
    }
    case 'capitalist': // 礼帽 + 金带
      g.add(box(pmat(PROP_COLORS.hatBrim), 0.6, 0.05, 0.6, 0, 0.325, 0));
      g.add(box(pmatGlow(PROP_COLORS.hatBand), 0.42, 0.05, 0.42, 0, 0.395, 0));
      g.add(box(pmat(PROP_COLORS.hatTop), 0.4, 0.28, 0.4, 0, 0.505, 0));
      return g;
    case 'farmer': // 草帽:宽檐 + 矮顶(草编织纹)
      g.add(box(fabricMat(PROP_COLORS.straw), 0.74, 0.05, 0.74, 0, 0.295, 0));
      g.add(box(fabricMat(PROP_COLORS.straw2), 0.4, 0.18, 0.4, 0, 0.405, 0));
      return g;
    case 'investor': { // 圆框眼镜(马甲/领带/袖套已烘进皮肤)
      const lens = pmat(PROP_COLORS.lens);
      g.add(box(lens, 0.15, 0.15, 0.03, -0.12, 0.025, 0.29));
      g.add(box(lens, 0.15, 0.15, 0.03, 0.12, 0.025, 0.29));
      g.add(box(lens, 0.1, 0.03, 0.03, 0, 0.025, 0.29));
      return g;
    }
    case 'glutton': // 厨师帽(围裙已烘进皮肤)
      g.add(box(pmat(PROP_COLORS.chefWhite), 0.46, 0.1, 0.46, 0, 0.325, 0));
      g.add(box(pmat(PROP_COLORS.chefWhite2), 0.5, 0.22, 0.5, 0, 0.485, 0));
      return g;
    default:
      return null;
  }
}
