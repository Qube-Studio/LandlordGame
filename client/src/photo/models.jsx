// 拍照棚可摆放模型：全部复用真身游戏资产，保证与游戏内像素级同款（美术单一真源）。
//  - 钞票：cards.jsx 的双面牌材质 + 同款盒体（面额 10/5/2/1、债务红变体、正/反）。
//  - 人物：挂 PlayerModel（默认体素人,?art=box 回退盒子人;六角色 + 表情 + 站/坐 + 破产）。
//  - 硬币：复用 Coin 的材质配方与尺寸常量，做成静态可变换网格（不自旋、不自定位，随坐标轴摆布）。
import { useMemo } from 'react';
import * as THREE from 'three';
import { cardMaterials, CARD_W, CARD_T, CARD_D } from '../scene/cards';
import { coinFaceTexture, coinEdgeTexture } from '../scene/textures';
import { COIN_R, COIN_H, COIN_SEGMENTS } from '../scene/coinSim';
import { PROP_COLORS } from '../assets/palette';
import { ROLE_LABEL } from '../game/roles';
import PlayerModel from '../scene/PlayerModel';

// 单张钞票牌（正面朝上=rotation.x 0，反面=π；债务=红变体）。
export function StudioNote({ value = 10, debt = false, faceUp = true }) {
  return (
    <mesh material={cardMaterials(value, debt)} rotation={[faceUp ? 0 : Math.PI, 0, 0]} castShadow>
      <boxGeometry args={[CARD_W, CARD_T, CARD_D]} />
    </mesh>
  );
}

// 人物：站姿默认脚踩 y=0（由外层 group.position 摆放）。名牌是 DOM 浮层，不进截图（截图只含 WebGL 画面）。
export function StudioCharacter({ role = 'landlord', expression = 'idle', seated = false, bankrupt = false, seed = 0 }) {
  const player = { role, bankrupt, online: true, name: ROLE_LABEL[role] ?? role };
  return <PlayerModel player={player} expression={expression} seed={seed} seated={seated} label={ROLE_LABEL[role] ?? role} />;
}

// 静态硬币（复用 Coin.jsx 的材质配方：暖金属 + 微 emissive；heads/tails 由 rotation.x 决定）。
export function StudioCoin({ face = 'heads' }) {
  const mats = useMemo(() => {
    const e = { emissive: new THREE.Color(PROP_COLORS.coinGlow), emissiveIntensity: 0.25 };
    const side = new THREE.MeshStandardMaterial({ map: coinEdgeTexture(), roughness: 0.4, metalness: 0.55, flatShading: true, ...e });
    const top = new THREE.MeshStandardMaterial({ map: coinFaceTexture('heads'), roughness: 0.4, metalness: 0.55, flatShading: true, ...e });
    const bottom = new THREE.MeshStandardMaterial({ map: coinFaceTexture('tails'), roughness: 0.4, metalness: 0.55, flatShading: true, ...e });
    return [side, top, bottom];
  }, []);
  return (
    <mesh material={mats} rotation={[face === 'heads' ? 0 : Math.PI, 0, 0]} castShadow>
      <cylinderGeometry args={[COIN_R, COIN_R, COIN_H * 2, COIN_SEGMENTS]} />
    </mesh>
  );
}

// 按 kind 分发（StudioScene 平铺与选中态共用）。
export function ItemModel({ item }) {
  const p = item.props;
  if (item.kind === 'note') return <StudioNote value={p.value} debt={p.debt} faceUp={p.faceUp} />;
  if (item.kind === 'coin') return <StudioCoin face={p.face} />;
  return <StudioCharacter role={p.role} expression={p.expression} seated={p.seated} bankrupt={p.bankrupt} seed={item.seed} />;
}
