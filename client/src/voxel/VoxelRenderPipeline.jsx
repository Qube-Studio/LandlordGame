// 主游戏体素画面方案的宿主组件：灯参/相位动画、酒馆自拍 IBL 与显式 AgX 后处理。
// 光照体积本体在 light/VoxelLight；这里不读取游戏规则，只接收纯表现参数。
/* eslint-disable react-hooks/immutability -- Three 场景环境、uniform 与灯强度按帧原地更新 */
/* eslint-disable react-refresh/only-export-components -- 本文件有意共置管线常量、hook 与宿主组件 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom, ToneMapping, Vignette } from '@react-three/postprocessing';
import { Effect as PPEffect, ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { P } from '../assets/palette';

export const VOX_LOOK = {
  ambient: { color: P.sceneAmbient, intensity: 0.2 },
  env: 0.35,
  exposure: 1.0,
  bloom: { intensity: 0.62, threshold: 0.7 },
  vignette: { offset: 0.28, darkness: 0.62 },
};

export const VOX_FILLS = [
  [-3.1, 2.9, -11.45], [3.1, 2.9, -11.45],
  [-5.4, 2.9, 11.45], [6.4, 2.9, 11.45],
  [-11.45, 2.9, 7.5], [11.45, 2.9, 6.5],
].map((pos) => ({ pos, color: P.candle, intensity: 3.2, distance: 5, srcR: 0.15 }));

export const VOX_MOON = { pos: [-9, 9, -15], color: P.coolFill, intensity: 0.55 };
export const VOX_SUN = { dir: VOX_MOON.pos, color: VOX_MOON.color, intensity: VOX_MOON.intensity };

// 与旧 ChandelierLight / FireLight 共用相位语义：抛币压光，落定短促回弹；关闭动态光时直达终态。
export function useVoxelLightRig(phase, lightAnim, reduced = false) {
  const animOffRef = useRef(reduced || !lightAnim);
  const phaseRef = useRef(phase);
  const chandelier = useRef(phase === 'COIN_FLIP' ? 21 * 0.55 : 21);
  const transition = useRef(null);
  const queue = useRef([]);

  useEffect(() => {
    animOffRef.current = reduced || !lightAnim;
    const previous = phaseRef.current;
    phaseRef.current = phase;
    if (animOffRef.current) {
      queue.current = [];
      transition.current = null;
      chandelier.current = phase === 'COIN_FLIP' ? 21 * 0.55 : 21;
    } else if (phase === 'COIN_FLIP') {
      queue.current = [{ to: 21 * 0.55, dur: 0.6 }];
    } else if (previous === 'COIN_FLIP') {
      queue.current = [{ to: 21 * 1.15, dur: 0.15 }, { to: 21, dur: 0.25 }];
    }
  }, [phase, lightAnim, reduced]);

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    if (!transition.current && queue.current.length) {
      const next = queue.current.shift();
      transition.current = { from: chandelier.current, ...next, start: now };
    }
    const tr = transition.current;
    if (!tr) return;
    const raw = Math.min(1, (now - tr.start) / Math.max(0.001, tr.dur));
    const t = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
    chandelier.current = tr.from + (tr.to - tr.from) * t;
    if (raw >= 1) transition.current = null;
  });

  return useMemo(() => [
    {
      pos: [0, 3.3, 0], color: P.candle, distance: 13.5, intensity: 21, srcR: 0.9,
      flicker: () => chandelier.current,
    },
    {
      pos: [0, 1.7, -10.5], color: P.fire, distance: 9, intensity: 7, srcR: 0.3,
      flicker: (t) => (animOffRef.current ? 7 : 7 + Math.sin(t * 2.3) * 1.2 + Math.sin(t * 5.1) * 0.6),
    },
  ], []);
}

function ActiveEnvironmentBake({ triggerKey }) {
  const { gl, scene } = useThree();
  const rig = useMemo(() => {
    const target = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
    const camera = new THREE.CubeCamera(0.1, 60, target);
    camera.position.set(0, 2.3, 0);
    return { target, camera };
  }, []);
  const previous = useRef(null);
  const schedule = useRef(null);
  const reschedule = useRef(true);

  useEffect(() => {
    previous.current = { environment: scene.environment, intensity: scene.environmentIntensity };
    return () => {
      if (scene.environment === rig.target.texture) scene.environment = previous.current?.environment ?? null;
      scene.environmentIntensity = previous.current?.intensity ?? 1;
      rig.target.dispose();
    };
  }, [scene, rig]);
  useEffect(() => { reschedule.current = true; }, [triggerKey]);

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    if (reschedule.current) {
      reschedule.current = false;
      schedule.current = [now + 0.2, now + 3.0];
    }
    if (schedule.current?.length && now >= schedule.current[0]) {
      schedule.current.shift();
      const keep = scene.environmentIntensity;
      scene.environmentIntensity = 0;
      rig.camera.update(gl, scene);
      scene.environmentIntensity = keep;
      scene.environment = rig.target.texture;
    }
    if (scene.environment === rig.target.texture) scene.environmentIntensity = VOX_LOOK.env;
  });
  return null;
}

export function VoxelEnvironmentBake({ active, triggerKey = '' }) {
  return active ? <ActiveEnvironmentBake triggerKey={triggerKey} /> : null;
}

class ExposureEffect extends PPEffect {
  constructor(exposure) {
    super(
      'VoxExposure',
      'uniform float uExp; void mainImage(const in vec4 c, const in vec2 uv, out vec4 o) { o = vec4(c.rgb * uExp, c.a); }',
      { uniforms: new Map([['uExp', new THREE.Uniform(exposure)]]) },
    );
  }
}

export function VoxelPostEffects({ extras = true }) {
  const exposure = useMemo(() => new ExposureEffect(VOX_LOOK.exposure), []);
  useEffect(() => () => exposure.dispose?.(), [exposure]);
  return (
    <EffectComposer disableNormalPass multisampling={0}>
      <primitive object={exposure} />
      {extras && (
        <Bloom
          intensity={VOX_LOOK.bloom.intensity}
          luminanceThreshold={VOX_LOOK.bloom.threshold}
          luminanceSmoothing={0.25}
          mipmapBlur
          radius={0.82}
          levels={7}
        />
      )}
      <ToneMapping mode={ToneMappingMode.AGX} />
      {extras && <Vignette offset={VOX_LOOK.vignette.offset} darkness={VOX_LOOK.vignette.darkness} />}
    </EffectComposer>
  );
}
