// 体素角色(VOXEL_PLAN P1 正式并回主游戏,2026-07-19)——骨架 v2:10 分件 .vox,
// 一级枢轴(肩/髋/头)沿用 MinecraftPlayer 动画语义,肩/髋组内再挂**肘/膝二级枢轴组**
// (上臂+前臂、大腿+小腿各自成件,常量取 charSpec.PIVOTS;比例微真人化,总高持平)。
// 肘随摆臂联动(后摆加弯)、膝静息微弯、坐姿=大腿前伸+膝弯小腿垂下。
// 荧幕 = 活的自发光贴片(texlib#screenFace 6 表情 + A/B 双帧 CRT 抖动)沉进头壳凹槽
// (§2.3:单 vox 做不了动态荧幕——壳体素化、屏保留贴片);投资人眼镜同理复用 HeadProp 半透明网格。
// 手持道具(算盘贴图面片/鸡腿)沿用原版网格;破产灰化=VoxModel desat(材质级去饱和,保留织纹)。
//
// 处决动作集(§3.9 批次5,程序化关节动画,经 `exec` prop 驱动——纯表现,数值由 Scene3D 从 state 算好):
//   exec = null | { yaw, pitch, fire, outcome }(仅行刑者非空;yaw/pitch=枪指向目标的**root 局部**角)
//   举枪:root 转体朝目标 + 右臂抬平(肘伸直)+ 右手挂左轮 + 头随枪向;放下=平滑回摆臂基线。
//   开枪:fire 计数变化即鸣枪——臂后坐上跳 + 枪口 Billboard 火光/点光 + 三缕烟(复用 muzzlefx 素材,
//     远景克制版);赦免枪(outcome='pardoned')臂甩向天(对空鸣枪的外部读法)。
//   中弹倒地:bankrupt false→true 侧向加速倒下+落地小回弹,躺地持续(灰化);冷挂载已破产=直接躺。
import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Billboard } from '@react-three/drei';
import VoxModel, { VOXEL_SIZE } from '../voxel/VoxModel';
import { CHAR_VOXEL_SIZE, CHAR_PARTS, PIVOTS, SCREEN, HATS } from '../voxel/charSpec';
import { HeadProp } from './MinecraftPlayer';
import { screenFace, tex } from '../assets/texlib';
import { P, PROP_COLORS, shade } from '../assets/palette';
import PixelText from '../assets/pixelfont/PixelText';
import { smootherstep } from './aim';
import { makeFlashTextures, makeSmokeTextures } from '../assets/muzzlefx';
import revolverUrl from '../assets/vox/props/revolver.vox?url';

const S = CHAR_VOXEL_SIZE;
const VOX_URLS = import.meta.glob('../assets/vox/props/char/*.vox', { query: '?url', import: 'default', eager: true });
const urlOf = (file) => VOX_URLS[`../assets/vox/props/char/${file}`];

// 金件头饰的运行时 glow(对齐 headProps#pmatGlow:emissive=金色本色、强度 0.35——白光会稀释金色相)
// 皇冠冠圈底的暗金色阶(shade -14,生成器同式)也要进名单,原版是整圈发光。
const HAT_GLOW = {
  landlord: [PROP_COLORS.crown, shade(PROP_COLORS.crown, -14)],
  capitalist: [PROP_COLORS.hatBand],
  prosecutor: [PROP_COLORS.crown],
};

// 枪口素材(模块级懒加载单例:同刻只有行刑者一人挂特效,变体 2 张足够)
let MUZZLE_TEX = null;
const muzzleTex = () => { MUZZLE_TEX ??= { flash: makeFlashTextures(2), smoke: makeSmokeTextures(2) }; return MUZZLE_TEX; };
const EXT_SMOKE_N = 3;

// ---- 荧幕贴片材质(模块级缓存 + CRT 抖动,机制照抄 MinecraftPlayer#partMats/flickerTick) ----
const nearest = (canvas) => {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};
const PLATE_CACHE = new Map();
const FLICKER = [];
let flickerStep = -1;
function flickerTick(t) {
  const step = Math.floor(t * 9);
  if (step === flickerStep) return;
  flickerStep = step;
  const useB = step % 6 === 0 || step % 17 === 5;
  for (const f of FLICKER) {
    const src = useB ? f.b : f.a;
    if (f.tex.image !== src.face) {
      f.tex.image = src.face; f.glow.image = src.glow;
      f.tex.needsUpdate = true; f.glow.needsUpdate = true;
    }
  }
}
function plateMat(expression, bankrupt) {
  const key = `${expression}|${bankrupt ? 1 : 0}`;
  let m = PLATE_CACHE.get(key);
  if (!m) {
    const a = screenFace({ expression, bankrupt, frame: 0 });
    const b = screenFace({ expression, bankrupt, frame: 1 });
    const texA = nearest(a.face), glowA = nearest(a.glow);
    m = new THREE.MeshStandardMaterial({
      map: texA, emissiveMap: glowA,
      emissive: new THREE.Color(P.chalkInk), emissiveIntensity: bankrupt ? 0.15 : 0.5,
      roughness: 1,
    });
    FLICKER.push({ tex: texA, glow: glowA, a, b });
    PLATE_CACHE.set(key, m);
  }
  return m;
}

const pmat = (color) => <meshStandardMaterial color={color} roughness={0.85} flatShading />;

export default function VoxPlayer({ player, expression, seed = 0, look = null, seated = false, label = null, exec = null }) {
  const role = player.role ?? 'none';
  const bankrupt = !!player.bankrupt;
  const root = useRef(), poseG = useRef(), lArm = useRef(), rArm = useRef(), head = useRef();
  const lElbow = useRef(), rElbow = useRef(), lKnee = useRef(), rKnee = useRef();
  const plateG = useRef(), flashRef = useRef(), fireLight = useRef();
  const smokeRefs = useRef([]);
  // 帧间动画态:fall=倒地进度(>1 段是落地回弹尾摆);aim=举枪进度;kick/pard=后坐;flash=火光;
  // seenFire=-1 哨兵(冷挂载吞掉历史开枪计数,不回放)
  const anim = useRef({
    fall: bankrupt ? 1.5 : 0, aim: 0, lastYaw: 0, lastPitch: 0,
    kick: 0, pard: 0, flash: 0, seenFire: -1,
    smoke: Array.from({ length: EXT_SMOKE_N }, () => ({ age: 99, life: 1, seed: 0 })),
  });
  const baseY = seated ? PIVOTS.seatedBaseY : 0;
  const legRot = seated ? PIVOTS.seatedLegRot : 0;
  const kneeRot = seated ? PIVOTS.seatedKnee : PIVOTS.kneeRest;
  const screen = useMemo(() => plateMat(expression ?? 'idle', bankrupt), [expression, bankrupt]);
  const abacusTex = useMemo(() => (role === 'investor' ? tex('abacus') : null), [role]);
  const fxTex = useMemo(() => (exec ? muzzleTex() : null), [exec]);

  // 动画:待机/欢呼/低头逐条对齐 MinecraftPlayer#useFrame(数值一致;荧幕抖动不吃 seed=全场同步);
  // 处决动作(举枪/开枪/倒地)叠加在其上,互斥关系:倒地 > 举枪 > 待机。
  useFrame((st, delta) => {
    flickerTick(st.clock.elapsedTime);
    const g = root.current, pg = poseG.current;
    if (!g || !pg) return;
    const t = st.clock.elapsedTime + seed;
    const f = anim.current;

    // ---- 中弹倒地进度(0 坐/站 → 1 躺平 → 1.5 回弹尾摆结束;复活/重开=快速爬回) ----
    if (bankrupt) f.fall = Math.min(1.5, f.fall + delta / 0.7);
    else f.fall = Math.max(0, f.fall - delta / 0.4);
    const fv = Math.min(1, f.fall);
    // 加速倒下(easeIn)+落地小回弹:侧向压过 π/2 一点,躺在凳旁地面
    const fallRot = fv * fv * 1.62
      + (f.fall > 1 ? Math.sin((f.fall - 1) * 16) * 0.1 * Math.max(0, 1 - (f.fall - 1) * 2.2) : 0);

    // ---- 举枪进度与开枪脉冲(仅行刑者 exec 非空) ----
    if (exec) { f.lastYaw = exec.yaw; f.lastPitch = exec.pitch; }
    f.aim = THREE.MathUtils.clamp(f.aim + (exec ? delta / 0.5 : -delta / 0.45), 0, 1);
    const ae = smootherstep(f.aim);
    const fireN = exec?.fire ?? null;
    if (fireN != null) {
      if (f.seenFire === -1) f.seenFire = fireN; // 冷挂载吞历史
      else if (fireN !== f.seenFire) {
        f.seenFire = fireN;
        f.kick = 1; f.flash = 1;
        f.pard = exec.outcome === 'pardoned' ? 1 : 0; // 赦免=对空鸣枪,臂甩向天
        for (const s of f.smoke) { s.age = -Math.random() * 0.08; s.life = 0.55 + Math.random() * 0.25; s.seed = Math.random() * 10; }
      }
    }
    f.kick = Math.max(0, f.kick - delta * 4.5);
    f.pard = Math.max(0, f.pard - delta * 2);
    f.flash = Math.max(0, f.flash - delta * 8);

    // ---- root(浮沉) + poseG(转体/倒地) ----
    if (!bankrupt) g.position.y = baseY + Math.sin(t * 1.6) * 0.03 * (1 - ae); // 瞄准时屏息不浮沉
    else g.position.y = baseY;
    pg.rotation.z = fallRot; // 倒地/爬回都按进度直写(进度本身带缓动,活人时恒 0)
    pg.rotation.y += (f.lastYaw * ae - pg.rotation.y) * 0.2; // 举枪转体朝目标
    if (plateG.current) plateG.current.position.y = 2.35 - smootherstep(fv) * 1.5; // 名牌随人落低

    if (!bankrupt) {
      if (lArm.current && rArm.current) {
        let lTarget, rTarget;
        if (expression === 'win') {
          const cheer = -2.6 + Math.sin(t * 6) * 0.12;
          lTarget = cheer; rTarget = cheer;
        } else {
          const swing = Math.sin(t * 1.8) * 0.18;
          lTarget = swing; rTarget = -swing;
        }
        if (ae > 0) {
          // 举枪:右臂抬平指向目标(pitch 上抬为负)+后坐上跳;赦免枪整臂甩向天。左臂垂稳。
          const aimArm = -Math.PI / 2 - f.lastPitch - f.kick * 0.5 - f.pard * 0.9;
          rTarget = rTarget + (aimArm - rTarget) * ae;
          lTarget = lTarget * (1 - ae) + -0.06 * ae;
        }
        lArm.current.rotation.x += (lTarget - lArm.current.rotation.x) * 0.3;
        rArm.current.rotation.x += (rTarget - rArm.current.rotation.x) * 0.3;
        // 肘联动:静息微弯,肩后摆(正旋)时加弯;举枪=右肘伸直
        for (const [arm, elbow, isR] of [[lArm, lElbow, false], [rArm, rElbow, true]]) {
          if (!elbow.current) continue;
          let bend = expression === 'win'
            ? -0.3
            : PIVOTS.elbowRest - Math.max(0, arm.current.rotation.x) * 0.9;
          if (isR && ae > 0) bend = bend * (1 - ae) + -0.04 * ae;
          elbow.current.rotation.x += (bend - elbow.current.rotation.x) * 0.3;
        }
      }
      // 膝:静息微弯 / 坐姿大弯(平滑过渡,坐↔站切换不跳变)
      for (const knee of [lKnee, rKnee]) {
        if (knee.current) knee.current.rotation.x += (kneeRot - knee.current.rotation.x) * 0.2;
      }
      if (head.current) {
        if (ae > 0.3) {
          // 举枪:头随枪向(转体已由 poseG 承担,头只补俯仰)
          head.current.rotation.y += (0 - head.current.rotation.y) * 0.2;
          head.current.rotation.x += (-f.lastPitch * 0.6 - head.current.rotation.x) * 0.2;
        } else if (look) {
          head.current.rotation.y += (look.yaw - head.current.rotation.y) * 0.2;
          head.current.rotation.x += (look.pitch - head.current.rotation.x) * 0.2;
        } else if (expression === 'lose') {
          head.current.rotation.y += (0 - head.current.rotation.y) * 0.15;
          head.current.rotation.x += (0.3 - head.current.rotation.x) * 0.15;
        } else {
          head.current.rotation.y = Math.sin(t * 0.7) * 0.18;
          head.current.rotation.x += (0 - head.current.rotation.x) * 0.1;
        }
      }
    }

    // ---- 枪口特效(火光 Billboard + 点光 + 三缕烟;远景克制版,仅 exec 挂载) ----
    if (flashRef.current) {
      const fl = f.flash;
      flashRef.current.visible = fl > 0;
      if (fl > 0) {
        flashRef.current.scale.setScalar(0.7 + fl * 0.5);
        flashRef.current.material.opacity = Math.min(1, fl * 1.3);
      }
    }
    if (fireLight.current) fireLight.current.intensity = f.flash * 10;
    for (let i = 0; i < EXT_SMOKE_N; i++) {
      const s = f.smoke[i];
      const m = smokeRefs.current[i];
      if (!m) continue;
      s.age += delta;
      const alive = s.age > 0 && s.age < s.life;
      m.visible = alive;
      if (!alive) continue;
      const u = s.age / s.life;
      m.position.y = s.age * 0.25 + Math.sin(s.age * 4 + s.seed) * 0.01;
      m.scale.setScalar(0.05 + u * 0.12);
      m.material.opacity = Math.min(1, u / 0.15) * Math.pow(1 - u, 1.5) * 0.35;
    }
  });

  const HAU = CHAR_PARTS.armUpper.grid[1] * S, HAL = CHAR_PARTS.armLower.grid[1] * S;
  const HLU = CHAR_PARTS.legUpper.grid[1] * S, HLL = CHAR_PARTS.legLower.grid[1] * S;
  const HH = CHAR_PARTS.head.grid[1] * S;
  return (
    <group ref={root} userData={{ voxBakeSkip: true }}>
      {/* 姿态组:转体(举枪)/倒地旋转都在这层——名牌留在外层,不随身体翻倒 */}
      <group ref={poseG}>
        {/* 腿 ×2:髋枢轴组(坐姿绕 X 前伸)→ 大腿 + 膝枢轴组 → 小腿(z+0.015 与大腿对轴,鞋含前伸脚) */}
        {[-1, 1].map((sx) => (
          <group key={sx} position={[sx * PIVOTS.hipX, PIVOTS.hipY, 0]} rotation={[legRot, 0, 0]}>
            <VoxModel url={urlOf(`leg-up-${role}.vox`)} scale={S} castShadow={false} position={[0, -HLU, 0]} desat={bankrupt} />
            <group ref={sx < 0 ? lKnee : rKnee} position={[0, PIVOTS.kneeY, 0]}>
              <VoxModel url={urlOf(`leg-lo-${role}.vox`)} scale={S} castShadow={false} position={[0, -HLL, 0.015]} desat={bankrupt} />
            </group>
          </group>
        ))}
        {/* 身(直挂姿态组,底=髋线) */}
        <VoxModel url={urlOf(`body-${role}.vox`)} scale={S} castShadow={false} position={[0, PIVOTS.hipY, 0]} desat={bankrupt} />
        {/* 臂 ×2:肩枢轴组(摆臂/欢呼/举枪绕肩顶)→ 上臂 + 肘枢轴组 → 前臂;手持道具挂前臂随肘联动 */}
        <group ref={lArm} position={[-PIVOTS.shoulderX, PIVOTS.shoulderY, 0]}>
          <VoxModel url={urlOf(`arm-up-${role}.vox`)} scale={S} castShadow={false} position={[0, -HAU, 0]} desat={bankrupt} />
          <group ref={lElbow} position={[0, PIVOTS.elbowY, 0]}>
            <VoxModel url={urlOf(`arm-lo-${role}.vox`)} scale={S} castShadow={false} position={[0, -HAL, 0]} desat={bankrupt} />
            {role === 'investor' && !bankrupt && (
              <mesh position={[0, -0.39, 0.18]} rotation={[0.35, 0, 0]}>
                <planeGeometry args={[0.34, 0.24]} />
                <meshStandardMaterial map={abacusTex} roughness={0.9} side={THREE.DoubleSide} />
              </mesh>
            )}
          </group>
        </group>
        <group ref={rArm} position={[PIVOTS.shoulderX, PIVOTS.shoulderY, 0]}>
          <VoxModel url={urlOf(`arm-up-${role}.vox`)} scale={S} castShadow={false} position={[0, -HAU, 0]} desat={bankrupt} />
          <group ref={rElbow} position={[0, PIVOTS.elbowY, 0]}>
            <VoxModel url={urlOf(`arm-lo-${role}.vox`)} scale={S} castShadow={false} position={[0, -HAL, 0]} desat={bankrupt} />
            {role === 'glutton' && !bankrupt && !exec && (
              <group position={[0, -0.41, 0.16]} rotation={[0.5, 0, 0]}>
                <mesh position={[0, 0.07, 0]}><boxGeometry args={[0.14, 0.2, 0.14]} />{pmat(PROP_COLORS.drumSkin)}</mesh>
                <mesh position={[0, -0.09, 0]}><boxGeometry args={[0.05, 0.14, 0.05]} />{pmat(PROP_COLORS.drumBone)}</mesh>
              </group>
            )}
            {/* 行刑者右手左轮(§3.9 批次5):枪口沿前臂向手外(+x→−y);枪口端挂火光/烟(Billboard 恒面向相机,
                交叉片禁令不破) */}
            {exec && (
              <group position={[0, -HAL - 0.05, 0.04]} rotation={[0, 0, -Math.PI / 2]}>
                <VoxModel url={revolverUrl} scale={VOXEL_SIZE * 0.5} anchor="center" castShadow={false} />
              </group>
            )}
            {exec && fxTex && (
              <group position={[0, -HAL - 0.24, 0.04]}>
                <Billboard>
                  <mesh ref={flashRef} visible={false}>
                    <planeGeometry args={[0.2, 0.2]} />
                    <meshBasicMaterial map={fxTex.flash[0]} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
                  </mesh>
                </Billboard>
                <pointLight ref={fireLight} intensity={0} distance={2.5} decay={2} color="#ffe0b0" />
                {Array.from({ length: EXT_SMOKE_N }, (_, i) => (
                  <Billboard key={i}>
                    <mesh ref={(el) => { smokeRefs.current[i] = el; }} visible={false}>
                      <planeGeometry args={[1, 1]} />
                      <meshBasicMaterial map={fxTex.smoke[i % fxTex.smoke.length]} transparent opacity={0} depthWrite={false} />
                    </mesh>
                  </Billboard>
                ))}
              </group>
            )}
          </group>
        </group>
        {/* 头:枢轴=头心;体素壳 + 荧幕贴片沉进凹槽 + 头饰(投资人眼镜=半透明网格特例) */}
        <group ref={head} position={[0, PIVOTS.headY, 0]}>
          {/* 机器头材质完全采用 .vox MATL 的逐色金属/粗糙度；破产只叠去饱和。 */}
          <VoxModel
            url={urlOf('head.vox')} scale={S} castShadow={false} position={[0, -HH / 2, 0]}
            desat={bankrupt}
          />
          <mesh position={[0, 0, SCREEN.plateZ]} material={screen}>
            <planeGeometry args={[HH, HH]} />
          </mesh>
          {!bankrupt && role === 'investor' && <HeadProp role="investor" />}
          {!bankrupt && HATS[role] && (
            <VoxModel
              url={urlOf(`hat-${role}.vox`)} scale={S} castShadow={false}
              position={[0, HATS[role].lift, 0]}
              emissiveColors={HAT_GLOW[role] ?? null} emissiveIntensity={0.35}
              emissive={HAT_GLOW[role]?.[0] ?? '#ffffff'}
            />
          )}
        </group>
      </group>
      {/* 名牌(同原版;在姿态组外——倒地时不随身体翻转,只随人落低) */}
      <group ref={plateG} position={[0, 2.35, 0]}>
        <Html center distanceFactor={6} zIndexRange={[30, 0]}>
          <div className={`mc-nameplate ${player.online ? '' : 'offline'}`}>
            <PixelText size={2} color={label != null ? 'var(--px-gold)' : '#fff'}>{label ?? player.name}</PixelText>
          </div>
        </Html>
      </group>
    </group>
  );
}
