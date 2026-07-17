// 掷币分镜相机（§3.4 演出，纯表现层）：COIN_FLIP 期从 CameraRig 手中接管相机，
// 按实时模拟轨迹的真实时间轴（coinSim hitAt/restAt,含滞空慢放延伸）播**四段分镜**——
// 切镜只发生在「拍摄内容变化」处（三版修订:旧「稳定后特写再切一次」与侧跟内容重复,已并）：
//   ① 仰拍滞空（唯一硬切进②）——贴毡低机位仰望硬币抛起翻落,滞空段子弹时间
//      （常速起抛→0.28× 平台→落台前回常速的梯形缓入缓出;镜头照常动、只有硬币慢）；
//   ② 落台长镜头——微距跟拍从首触起的全部物理戏:弹跳、贴缘滚弧、陀螺式立转
//      越转越低,一路看到躺平（锚点阻尼跟随,缓慢环绕+推近）；
//   ③ 揭示（同一长镜头**连续**升起,不切）——升机位俯望币面读结果,打光闪+币面脉冲；
//   ④ 缓动归位——smootherstep 混合回落座中性位,到位后 setCine('enter')放行 UI 出场,
//      父层卸载本组件、CameraRig 以零跳变接管（中性位=其 lookAt 初值）。
// 手持感：①②微晃 ③收敛 ④归零；FOV 逐镜变焦（切镜快照、镜内阻尼）。
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
    anchor: { x: 0, z: 0 },                          // 跟拍锚点（硬币 xz 的阻尼跟随）
    restAt: null,                                    // 闩存的落定时刻（硬币卸载后时间轴不回跳）
    hitAt: null,                                     // 闩存的首触时刻（①→② 切镜锚点）
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
      const lv = getCoinFlightLive();
      rig.anchor.x = lv?.x ?? 0; rig.anchor.z = lv?.z ?? 0; // 锚点直接落在抛掷起点
    }
    const t = st.clock.elapsedTime - rig.start;

    // 硬币实时世界位姿 + 真实时间轴（Coin 每帧发布,restAt/hitAt 含慢放延伸；闩存——
    // 相位推进后 flip 硬币卸载、实时通道清空，归位段时间轴不能回跳）
    const live = getCoinFlightLive();
    if (live) { rig.restAt = live.restAt; rig.hitAt = live.hitAt; }
    const restAt = rig.restAt ?? 4.2;
    const hitAt = rig.hitAt ?? 1.0;
    const coinX = live?.x ?? 0, coinY = live?.y ?? tableTop + 1.2, coinZ = live?.z ?? 0;
    // 落点（挂载即知，local→world 旋 rot）
    const rl = getCoinRest();
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const restX = rl ? rl.x * cr + rl.z * sr : 0;
    const restZ = rl ? -rl.x * sr + rl.z * cr : 0;

    // 跟拍锚点：硬币 xz 的阻尼跟随——弹跳/滚缘的横向移动柔和入镜，不直传抖动
    rig.anchor.x += (coinX - rig.anchor.x) * damp(0.02, delta);
    rig.anchor.z += (coinZ - rig.anchor.z) * damp(0.02, delta);

    // 分镜时刻表（随该掷的真实时间轴伸缩）：
    // t1 滞空→落台长镜头(唯一硬切,首触前一瞬), t3 长镜头→揭示升起(连续), t4 归位起, t5 归位完成
    const t1 = Math.max(0.4, hitAt - 0.05);
    const t3 = restAt + 0.5;
    let t4 = restAt + 1.25;
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

    const shot = t >= t4 ? 3 : t < t1 ? 0 : t < t3 ? 1 : 2;
    if (glintRef.current && shot !== 2) glintRef.current.intensity = 0; // 打光闪只活在揭示镜③
    // 调试/截图探针（同 __payoutDir 先例）：分镜时间轴与镜号,供 E2E 对时
    if (import.meta.env.DEV && typeof window !== 'undefined') window.__cineDbg = { t, shot, restAt, hitAt, glint: glintRef.current?.intensity ?? 0 };

    // 本帧的目标位置/注视/视场（Ø11cm 硬币 → 近距机位）
    let px, py, pz, ax, ay, az, fovT, aimK;
    // 落台长镜头与揭示共用的环绕方位（连续推进,②→③无切）
    const aziG = rig.azi0 + rig.side * (1.35 + 0.3 * Math.max(0, t - t1));
    if (shot === 0) {
      // ① 仰拍滞空：贴毡低机位仰望翻落的硬币（滞空段硬币慢放=子弹时间,镜头照常动）
      const azi = rig.azi0 + rig.side * 0.18 * t;
      px = rig.anchor.x + Math.sin(azi) * 0.7; py = tableTop + 0.12; pz = rig.anchor.z + Math.cos(azi) * 0.7;
      ax = coinX; ay = coinY; az = coinZ;
      fovT = 56; aimK = 0.002;
    } else if (shot === 1) {
      // ② 落台长镜头（唯一硬切入此）：微距跟拍全部落台物理戏——弹跳/滚缘/陀螺立转
      //    越转越低直到躺平；缓慢环绕 + 随戏推近（0.42→0.30）
      const u = Math.min(1, Math.max(0, (t - t1) / Math.max(0.6, t3 - t1)));
      const r = 0.42 - 0.12 * u, h = 0.09 + 0.04 * u;
      px = rig.anchor.x + Math.sin(aziG) * r; py = tableTop + h; pz = rig.anchor.z + Math.cos(aziG) * r;
      ax = coinX; ay = Math.min(coinY, tableTop + 0.3); az = coinZ;
      fovT = 46; aimK = 0.008;
    } else if (shot === 2) {
      // ③ 揭示（从②**连续**升起,不切）：升机位俯望币面读结果 + 「闪亮一下」
      const u = smooth((t - t3) / (t4 - t3));
      const r = 0.30 + 0.14 * u, h = 0.13 + 0.42 * u;
      px = restX + Math.sin(aziG) * r; py = tableTop + h; pz = restZ + Math.cos(aziG) * r;
      ax = restX; ay = tableTop + 0.005; az = restZ;
      fovT = 44 + 3 * u; aimK = 0.0005;
      // 「闪亮一下」（进揭示段即刻，双管齐下保证肉眼可见）：
      // ① 币面金光脉冲——躺平的硬币「接住」光闪一下（Coin 消费 requestCoinPulse）；
      // ② 打光闪——一盏暖白点光贴近币面快起缓落地掠过，币旁亮起一汪光池又熄灭。
      if (!rig.pulsed) { rig.pulsed = true; requestCoinPulse(); }
      if (glintRef.current) {
        // 包络用**线性**进度（smootherstep 开局压得太慢,曾把攻期拖没）
        const ul = Math.min(1, Math.max(0, (t - t3) / (t4 - t3)));
        const g = ss((ul - 0.03) / 0.1) * (1 - ss((ul - 0.28) / 0.5));
        const phi = aziG + rig.side * (1.15 - 2.3 * ul);
        glintRef.current.position.set(restX + Math.sin(phi) * 0.28, tableTop + 0.4, restZ + Math.cos(phi) * 0.28);
        glintRef.current.intensity = 2.6 * g;
      }
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

    // 手持微晃：①②明显、③收敛、④随混合归零（近距机位下振幅同步缩小）
    const wob = shot === 0 ? 0.007 : shot === 1 ? 0.005 : shot === 2 ? 0.002
      : 0.002 * (1 - smooth((t - t4) / (t5 - t4)));
    px += (Math.sin(t * 1.9) + 0.6 * Math.sin(t * 3.7 + 1.3)) * wob;
    py += Math.cos(t * 2.3 + 0.7) * wob * 0.7;

    // 切镜=硬切：位置/注视/视场全部瞬移到位（分镜语言里的 cut,只发生在 ①→②；②→③连续）
    if (shot !== rig.shot && shot <= 1) {
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
