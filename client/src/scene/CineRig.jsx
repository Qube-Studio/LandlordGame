// 掷币分镜相机（§3.4 演出，纯表现层）：COIN_FLIP 期从 CameraRig 手中接管相机，
// 按烘焙轨迹的落定时刻（coinSim restAt）自适应地播五段分镜：
//   ① 仰拍起抛（硬切）——贴桌低机位仰视硬币从高处翻落，广角；
//   ② 低机位侧跟（硬切）——桌面高度侧面缓慢环绕，跟拍弹跳，长焦压缩 + 轻微荷兰角；
//   ③ 贴桌特写收势（硬切）——锚定落点的缓推特写，看最后几次「翘起→拍平」；
//   ④ 升机位俯视揭示（连续）——从特写缓缓升起俯望币面，读清结果；
//   ⑤ 缓动归位——smootherstep 混合回落座中性位（正对桌心），到位后 setCine('enter')
//      放行 UI 出场，父层卸载本组件、CameraRig 以零跳变接管（中性位=其 lookAt 初值）。
// 手持感：①②微晃 ③④收敛 ⑤归零；FOV 逐镜变焦（切镜快照、镜内阻尼）。
// 兜底：卸载时还原 fov=基准值；若分镜没走完（相位跳变/切自由相机），cine 卡在 'hide' 就放行。
// useFrame 内逐帧改写 camera 位姿/fov 是 r3f 既定用法（与 CameraRig 同款豁免）。
/* eslint-disable react-hooks/immutability */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getCoinFlightLive, getCoinRest, requestCoinPulse } from './coinSim';
import { useGameStore } from '../store/gameStore';

const BASE_FOV = 58;                 // 与 Scene3D Canvas 初始 fov 一致（归位/兜底还原目标）
const smooth = (u) => { const t = Math.min(1, Math.max(0, u)); return t * t * t * (t * (t * 6 - 15) + 10); };
const ss = (x) => { const v = Math.min(1, Math.max(0, x)); return v * v * (3 - 2 * v); }; // 平滑阶跃
const damp = (k, dt) => 1 - Math.pow(k, dt); // 指数阻尼系数（帧率无关）
const _aimT = new THREE.Vector3();   // 每帧注视目标临时向量（useFrame 内零分配）

export default function CineRig({ camZ, eyeY, lookY, rot, tableTop }) {
  const { camera } = useThree();
  const glintRef = useRef();         // 末镜「打光闪」点光源（掠过币面的镜面高光，非硬币自发光）

  // 观察方位（side=环绕方向、azi0=起始方位微偏）在首帧随机化（render 期须纯）——同一条轨迹分镜也不重样
  const rig = useMemo(() => ({
    side: 1,
    azi0: 0,
    start: null,
    shot: -1,
    aim: new THREE.Vector3(0, tableTop + 1.2, 0),   // 阻尼注视点（切镜时快照到位）
    restAt: null,                                    // 闩存的落定时刻（硬币卸载后时间轴不回跳）
    rushT4: null,                                    // REFLIP 加速归位的提前 t4（一次性闩存）
    pulsed: false,                                   // 揭示镜的币面金光脉冲只点一次火
    donePos: null, doneAim: null, doneFov: BASE_FOV, // 归位起点快照
    finished: false,
  }), [tableTop]);

  // 卸载兜底：还原 fov；分镜中途被拆（相位跳变/断线）也不让 UI 卡在收起态。
  // rig.start 闸 = 只有真跑过帧才兜底——StrictMode 的假卸载发生在首帧之前，
  // 不能让它把 cine 踢到 'enter' 杀死整场分镜（真没跑帧的病理路径由 GameScreen 8s 兜底接住）。
  useEffect(() => () => {
    camera.fov = BASE_FOV;
    camera.updateProjectionMatrix();
    const st = useGameStore.getState();
    if (rig.start != null && st.cine === 'hide') st.setCine('enter');
  }, [camera, rig]);

  useFrame((st, delta) => {
    if (rig.finished) return;
    if (rig.start == null) {
      rig.start = st.clock.elapsedTime;
      rig.side = Math.random() < 0.5 ? 1 : -1;
      rig.azi0 = (Math.random() - 0.5) * 0.9;
    }
    const t = st.clock.elapsedTime - rig.start;

    // 硬币实时世界位姿 + 该轨迹的落定时刻（Coin 每帧发布；首帧未发布时按桌心/经验值兜底；
    // 落定时刻闩存——相位推进后 flip 硬币卸载、实时通道清空，归位段时间轴不能回跳）
    const live = getCoinFlightLive();
    if (live) rig.restAt = live.restAt;
    const restAt = rig.restAt ?? 4.2;
    const coinX = live?.x ?? 0, coinY = live?.y ?? tableTop + 1.2, coinZ = live?.z ?? 0;
    // 落点（挂载即知，local→world 旋 rot）
    const rl = getCoinRest();
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const restX = rl ? rl.x * cr + rl.z * sr : 0;
    const restZ = rl ? -rl.x * sr + rl.z * cr : 0;

    // 分镜时刻表（随落定时刻伸缩）：t1 起抛→侧跟, t2 侧跟→特写, t3 特写→升起, t4 升起→归位, t5 归位完成
    const t1 = 1.05;
    const t2 = Math.max(t1 + 0.5, restAt - 1.15);
    const t3 = restAt + 0.7;
    let t4 = restAt + 1.45;
    // 提前归位（rushT4 一次性闩存）：
    // ① REFLIP/NEGOTIATE/FINALIZE 需要玩家交互——相位一到就压掉剩余镜头，UI 尽快回场；
    // ② 其他相位若在本地时间轴早期(<5.5s)就离开了 COIN_FLIP，说明是中途接入（重连/晚挂载：
    //    本地硬币与分镜都从 0 重播，而服务器时钟已在尾声）——立即快进归位，不把刚回来的
    //    玩家深锁在收起的 UI 里（对抗审查确认项）。正常路径 SETTLE 到达于 t≈6.0s，不受影响。
    if (rig.rushT4 == null) {
      const ph = useGameStore.getState().state?.phase;
      if (ph && ph !== 'COIN_FLIP' && (ph !== 'SETTLE' || t < 5.5)) rig.rushT4 = Math.min(t4, t);
    }
    if (rig.rushT4 != null) t4 = Math.min(t4, rig.rushT4);
    const t5 = t4 + 0.95;

    const shot = t >= t4 ? 4 : t < t1 ? 0 : t < t2 ? 1 : t < t3 ? 2 : 3;
    if (glintRef.current && shot !== 3) glintRef.current.intensity = 0; // 打光闪只活在末镜④

    // 本帧的目标位置/注视/视场
    let px, py, pz, ax, ay, az, fovT, aimK;
    if (shot === 0) {
      // ① 仰拍起抛：贴桌低机位，视线越过毡面仰望翻落的硬币；缓慢横移
      const azi = rig.azi0 + rig.side * 0.12 * t;
      px = Math.sin(azi) * 1.55; py = tableTop + 0.18; pz = Math.cos(azi) * 1.55;
      ax = coinX; ay = coinY; az = coinZ;
      fovT = 63; aimK = 0.002;
    } else if (shot === 1) {
      // ② 低机位侧跟：桌面高度侧面环绕，跟拍弹跳（注视阻尼放软，弹跳不甩镜头）。
      // 轨道半径须避开下注圈环带（SPOT 半长轴 2.05，圈上有注堆）——取 1.72 从环内掠过。
      const azi = rig.azi0 + rig.side * (1.35 + 0.26 * (t - t1));
      px = Math.sin(azi) * 1.72; py = tableTop + 0.42; pz = Math.cos(azi) * 1.72;
      ax = coinX; ay = Math.min(coinY, tableTop + 0.8); az = coinZ;
      fovT = 50; aimK = 0.01;
    } else if (shot === 2 || shot === 3) {
      // ③④ 锚定落点的特写→升机位揭示：③ 半径缓推 1.05→0.82、微降；④ 升到俯视缓拉开
      const aziC = rig.azi0 + rig.side * (2.2 + 0.06 * (t - t2));
      let r, h;
      if (shot === 2) {
        const u = smooth((t - t2) / (t3 - t2));
        r = 1.05 - 0.23 * u; h = 0.44 - 0.08 * u;
        fovT = 44;
      } else {
        const u = smooth((t - t3) / (t4 - t3));
        r = 0.82 + 0.13 * u; h = 0.36 + 0.99 * u;
        fovT = 44 + 3 * u;
        // 末镜「闪亮一下」（进揭示镜即刻，双管齐下保证肉眼可见）：
        // ① 币面金光脉冲——躺平的硬币「接住」光闪一下（Coin 消费 requestCoinPulse）；
        // ② 强打光闪——一盏暖白点光贴近币面快起缓落地掠过，被压暗的全场里币旁亮起
        //    一汪光池又熄灭。攻 ~0.1/衰 ~0.5（按镜④进度 u 计），扫掠方向随环绕侧向。
        if (!rig.pulsed) { rig.pulsed = true; requestCoinPulse(); }
        if (glintRef.current) {
          const g = ss((u - 0.03) / 0.1) * (1 - ss((u - 0.28) / 0.5));
          const phi = aziC + rig.side * (1.15 - 2.3 * u);
          glintRef.current.position.set(restX + Math.sin(phi) * 0.7, tableTop + 0.85, restZ + Math.cos(phi) * 0.7);
          glintRef.current.intensity = 30 * g;
        }
      }
      px = restX + Math.sin(aziC) * r; py = tableTop + h; pz = restZ + Math.cos(aziC) * r;
      ax = restX; ay = tableTop + 0.05; az = restZ;
      aimK = 0.0005;
    } else {
      // ⑤ 归位：进段瞬间快照当前位姿，smootherstep 混合到落座中性位（正对桌心）——
      // 中性位恰是 CameraRig 重挂后的 lookAt 初值，交接零跳变，随后鼠标环视自然软接管。
      if (!rig.donePos) {
        rig.donePos = camera.position.clone();
        rig.doneAim = rig.aim.clone();
        rig.doneFov = camera.fov;
      }
      const u = smooth((t - t4) / (t5 - t4));
      px = rig.donePos.x + (0 - rig.donePos.x) * u;
      py = rig.donePos.y + (eyeY - rig.donePos.y) * u;
      pz = rig.donePos.z + (camZ - rig.donePos.z) * u;
      ax = rig.doneAim.x + (0 - rig.doneAim.x) * u;
      ay = rig.doneAim.y + (lookY - rig.doneAim.y) * u;
      az = rig.doneAim.z + (0 - rig.doneAim.z) * u;
      camera.fov = rig.doneFov + (BASE_FOV - rig.doneFov) * u;
      camera.updateProjectionMatrix();
      fovT = null; aimK = null;

      if (t >= t5) {
        rig.finished = true;
        camera.position.set(0, eyeY, camZ);
        camera.lookAt(0, lookY, 0);
        camera.fov = BASE_FOV;
        camera.updateProjectionMatrix();
        if (glintRef.current) glintRef.current.intensity = 0;
        useGameStore.getState().setCine('enter'); // 放行 UI 出场；父层随之卸载本组件
        return;
      }
    }

    // 手持微晃：①②明显、③④收敛、⑤随混合归零
    const wob = shot === 0 ? 0.018 : shot === 1 ? 0.014 : shot <= 3 ? 0.005
      : 0.005 * (1 - smooth((t - t4) / (t5 - t4)));
    px += (Math.sin(t * 1.9) + 0.6 * Math.sin(t * 3.7 + 1.3)) * wob;
    py += Math.cos(t * 2.3 + 0.7) * wob * 0.7;

    // 切镜=硬切：位置/注视/视场全部瞬移到位（分镜语言里的 cut，不做跨镜插值）
    if (shot !== rig.shot && shot <= 2) {
      rig.shot = shot;
      camera.position.set(px, py, pz);
      rig.aim.set(ax, ay, az);
      if (fovT != null) { camera.fov = fovT; camera.updateProjectionMatrix(); }
    } else {
      rig.shot = shot;
      camera.position.set(px, py, pz);
      if (aimK != null) rig.aim.lerp(_aimT.set(ax, ay, az), damp(aimK, delta));
      else rig.aim.set(ax, ay, az);
      if (fovT != null && Math.abs(camera.fov - fovT) > 0.05) {
        camera.fov += (fovT - camera.fov) * damp(0.02, delta);
        camera.updateProjectionMatrix();
      }
    }
    camera.lookAt(rig.aim);
    // 荷兰角：侧跟镜微倾（lookAt 已归零 roll，这里再补一点）
    if (shot === 1) camera.rotateZ(rig.side * 0.035);
  });

  // 末镜打光闪的光源（世界系，随 rig 挂卸；平时 intensity=0 零开销）
  return <pointLight ref={glintRef} intensity={0} distance={4.5} decay={2} color="#ffefc8" />;
}
