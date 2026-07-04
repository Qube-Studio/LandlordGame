// 3D 手牌层（BETTING · 桌面直接操作，§交互 3D 化）：
// 余额分解成真实纸牌模型捏在相机前（扇形），抬头（鼠标移向屏幕上方）自动收进手里；
// 拖一张牌到自己的圆圈附近 = 暂存下注（重力枪式悬浮跟随），点圈里的牌收回手中；
// 长按手牌 450ms 拆分（140ms 起抖，与 2D MoneyHand 同参数）；保留金摆在圆圈外正面朝上不可交互；
// 投资人多一个投保圈。确认（Enter / 点圆圈浮字）后暂存牌原地成为 myStack——零接力跳变，
// 服务端协议不变（只发 place_bet）。强制全押走既有 FlyingNotes 管线（手牌位置投影成屏幕起点）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import { decompose, splitNote, SPLITS } from '../game/notes';
import { MoneyStack, ArcNote, cardMaterials, cardLocal, cardYaw, stackTopY, TABLE_TOP, CARD_W, CARD_T, CARD_D } from './cards';
import { groundFromPointer, CarrySpring } from './carry';
import PixelText from '../assets/pixelfont/PixelText';
import { P } from '../assets/palette';

const UP = new THREE.Vector3(0, 1, 0);
const _fanTarget = new THREE.Vector3();   // 每帧即用即弃的划痕向量（单帧内同步使用，可全组件共享）
const _carryTarget = new THREE.Vector3();
const LONG_PRESS_MS = 450;   // 长按拆分（与 2D MoneyHand 同参数）
const SHAKE_DELAY_MS = 140;  // 开始抖动的延迟（短按不抖）
const DRAG_START_PX = 8;     // 按下后移动超过该像素数 = 开始拖拽（否则视为长按候选）
const HAND_Z = -1.18, HAND_Y = -0.52;  // 手牌扇在相机局部系里的位置
const HAND_SCALE = 0.5;      // 手里的牌比桌上的小一圈（近相机，原尺寸会占掉半个屏幕）
const BET_DROP_R = 0.85;     // 「拖到圆圈附近」的判定半径
const PLEDGE_DROP_R = 0.55;

// 手里的单张牌：扇形槽位 + 悬停抬起 + 长按抖动。位置每帧向目标缓动（重排/新增都顺滑）。
function HandCard({ note, i, mid, spacing, shaking, disabled, onDown, register }) {
  const ref = useRef();
  const [hover, setHover] = useState(false);
  useFrame((st) => {
    const m = ref.current;
    if (!m) return;
    const sh = shaking ? Math.sin(st.clock.elapsedTime * 55) * 0.014 : 0;
    _fanTarget.set(
      (i - mid) * spacing + sh,
      HAND_Y - (i - mid) * (i - mid) * 0.004 + (hover && !disabled ? 0.045 : 0),
      HAND_Z + (hover && !disabled ? 0.04 : 0),
    );
    m.position.lerp(_fanTarget, 0.35);
    m.rotation.set(Math.PI / 2 - 0.42, sh * 2, -(i - mid) * 0.05);
    m.scale.setScalar(THREE.MathUtils.lerp(m.scale.x, (hover && !disabled ? 1.12 : 1) * HAND_SCALE, 0.3));
  });
  return (
    <mesh
      ref={(m) => { ref.current = m; register(note.id, m); }}
      material={cardMaterials(note.value)}
      position={[(i - mid) * spacing, HAND_Y - 0.2, HAND_Z]}
      onPointerDown={(e) => { e.stopPropagation(); onDown(note, e); }}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); }}
      onPointerOut={() => setHover(false)}
    >
      <boxGeometry args={[CARD_W, CARD_T, CARD_D]} />
    </mesh>
  );
}

// 暂存在圆圈里的牌（桌面局部系，槽位与 Scene3D 的 myStack 完全一致——确认后零跳变接力）。
// spawn = 拖拽落点（世界系），落下时短促滑入槽位并翻成背面（下注保密）。
function StagedCard({ note, i, spot, rot, onClick }) {
  const ref = useRef();
  const t0 = useRef(null);
  const from = useRef(note.spawn ? new THREE.Vector3(...note.spawn).applyAxisAngle(UP, -rot) : null);
  useFrame((st) => {
    const m = ref.current;
    if (!m) return;
    const l = cardLocal(i);
    const tx = spot.x + l[0], ty = l[1], tz = spot.z + l[2];
    if (from.current) {
      if (t0.current == null) t0.current = st.clock.elapsedTime;
      const t = Math.min(1, (st.clock.elapsedTime - t0.current) / 0.22);
      const e = 1 - (1 - t) * (1 - t);
      m.position.set(
        from.current.x + (tx - from.current.x) * e,
        from.current.y + (ty - from.current.y) * e,
        from.current.z + (tz - from.current.z) * e,
      );
      m.rotation.set(Math.PI * e, cardYaw(i) * e, 0);
      if (t >= 1) from.current = null;
    } else {
      m.position.set(tx, ty, tz);
      m.rotation.set(Math.PI, cardYaw(i), 0);
    }
  });
  return (
    <mesh
      ref={ref}
      material={cardMaterials(note.value)}
      castShadow
      onClick={(e) => { e.stopPropagation(); onClick(note); }}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { document.body.style.cursor = ''; }}
    >
      <boxGeometry args={[CARD_W, CARD_T, CARD_D]} />
    </mesh>
  );
}

// 被重力枪抓着的牌：弹簧追踪指针射线在桌面上方的悬浮点，随速度倾斜。
function CarriedNote({ note, carryRef, ndcRef }) {
  const ref = useRef();
  const { camera } = useThree();
  useFrame((_, dt) => {
    const c = carryRef.current;
    const m = ref.current;
    if (!c || !m) return;
    groundFromPointer(camera, ndcRef.current, _carryTarget);
    _carryTarget.y = TABLE_TOP + 0.55;
    c.spring.update(_carryTarget, dt);
    m.position.copy(c.spring.pos);
    c.spring.tilt(m.rotation);
    m.visible = true; // 首帧就位后才显形，避免在原点闪一帧
  });
  return (
    <mesh ref={ref} material={cardMaterials(note.value)} castShadow visible={false}>
      <boxGeometry args={[CARD_W, CARD_T, CARD_D]} />
    </mesh>
  );
}

// 落区细虚环（投保圈常驻淡显；下注圈仅拖拽时点亮——毡面本身已烘了下注圈）
function ZoneRing({ pos, r = 0.34, opacity = 0.3 }) {
  return (
    <mesh position={[pos.x, TABLE_TOP + 0.006, pos.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[r - 0.04, r, 28]} />
      <meshBasicMaterial color={P.gold} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

export default function HandLayer({ look, rot, mySpot }) {
  const state = useGameStore(s => s.state);
  const send = useGameStore(s => s.send);
  const chatOpen = useGameStore(s => s.chatOpen);
  const placeTableStack = useGameStore(s => s.placeTableStack);
  const startBetFlight = useGameStore(s => s.startBetFlight);
  const { camera, size } = useThree();

  const me = state.me;
  const bounds = me.bounds ?? { minStake: 1, min: 1, max: me.balance, forceAllIn: false };
  const noReserve = bounds.forceAllIn || bounds.max >= me.balance;
  const spendable = noReserve ? me.balance : me.balance - bounds.minStake;

  const [hand, setHand] = useState(() => decompose(spendable));
  const [staged, setStaged] = useState([]);   // 圆圈里的暂存注 [{id,value,spawn}]
  const [pledged, setPledged] = useState([]); // 投保圈 [{id,value,spawn}]
  const [carry, setCarry] = useState(null);   // {note} —— 正被重力枪抓着的牌
  const [flights, setFlights] = useState([]); // 收回手中/保单下沉的过渡飞牌
  const [shakingId, setShakingId] = useState(null);
  const [sent, setSent] = useState(false);

  const carryRef = useRef(null);
  const ndcRef = useRef({ x: 0, y: 0 });
  const downRef = useRef(null);
  const pressActiveRef = useRef(false);   // 真实按键是否仍按住（window pointerdown/up，可靠，不受 r3f 射线延迟影响）
  const pressTimer = useRef(null);
  const shakeTimer = useRef(null);
  const cardRefs = useRef(new Map());
  const handGroup = useRef();
  const handInner = useRef();
  const tuckRef = useRef(0);
  const confirmRef = useRef(null);

  const total = staged.reduce((s, n) => s + n.value, 0);
  const premium = pledged.reduce((s, n) => s + n.value, 0);
  const effMax = Math.max(0, bounds.max - premium);
  const canConfirm = bounds.forceAllIn || (total >= bounds.min && total <= effMax);
  const insurable = me.role === 'investor' && !bounds.forceAllIn;
  const maxPledge = me.pledgeMax ?? 3;
  const interactive = !sent && !bounds.forceAllIn;

  // 桌面锚点（世界系）：我的圆圈 / 圈外右侧保留金 / 圈外左侧投保圈
  const worldSpot = useMemo(() => new THREE.Vector3(mySpot.x, 0, mySpot.z).applyAxisAngle(UP, rot), [mySpot, rot]);
  const tangent = useMemo(() => {
    const o = worldSpot.clone().setY(0);
    const L = o.length() || 1;
    o.divideScalar(L);
    return new THREE.Vector3(o.z, 0, -o.x); // 面向桌心时的右手方向
  }, [worldSpot]);
  const reservePos = useMemo(() => worldSpot.clone().addScaledVector(tangent, 0.98), [worldSpot, tangent]);
  const pledgePos = useMemo(() => worldSpot.clone().addScaledVector(tangent, -1.02), [worldSpot, tangent]);
  const reserveNotes = useMemo(() => (noReserve ? [] : decompose(bounds.minStake)), [noReserve, bounds.minStake]);

  const clearTimers = () => {
    clearTimeout(pressTimer.current);
    clearTimeout(shakeTimer.current);
  };

  // 手牌扇跟随相机 + 抬头收起（look.y 越小 = 鼠标越靠屏幕上方）
  useFrame((_, dt) => {
    const g = handGroup.current;
    if (!g) return;
    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);
    const want = (look.current.y < -0.30 || sent) ? 1 : 0;
    tuckRef.current += (want - tuckRef.current) * Math.min(1, dt * 7);
    const t = tuckRef.current;
    const inner = handInner.current;
    if (inner) {
      inner.position.y = -t * 0.85;
      inner.rotation.x = -t * 0.8;
    }
  });

  // 手牌前方的收拢点（世界系）：收回的牌飞向这里再插回扇中
  const handCatchPoint = () => {
    const v = new THREE.Vector3(0, HAND_Y + 0.15, HAND_Z);
    return v.applyMatrix4(camera.matrixWorld);
  };

  const returnToHand = (note, fromPos) => {
    const to = handCatchPoint();
    setFlights(f => [...f, {
      key: `rt-${note.id}`, value: note.value, from: fromPos, to: [to.x, to.y, to.z],
      shrinkOut: true, note,
    }]);
  };

  // 全局指针：按下=标记按住；移动=更新 NDC / 判定拖拽起步；抬起=落牌判定 + 清按住标记。
  // 按住标记走 window 事件（可靠）——r3f 的射线拾取在慢机上会延迟到 mouseup 之后才触发
  // onHandDown，若那时才盲目 arm 拆分定时器就会「明明想拖却拆了牌」。
  useEffect(() => {
    const onDown = () => { pressActiveRef.current = true; };
    const onMove = (e) => {
      ndcRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      ndcRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
      const d = downRef.current;
      if (!d || carryRef.current) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_START_PX) return;
      // 移动超阈值：取消长按拆分，从手里抽出这张牌开始携带
      clearTimers();
      setShakingId(null);
      const mesh = cardRefs.current.get(d.note.id);
      const start = new THREE.Vector3();
      if (mesh) mesh.getWorldPosition(start); else groundFromPointer(camera, ndcRef.current, start);
      setHand(h => h.filter(n => n.id !== d.note.id));
      carryRef.current = { note: d.note, spring: new CarrySpring(start) };
      setCarry({ note: d.note });
    };
    const onUp = () => {
      pressActiveRef.current = false;
      clearTimers();
      setShakingId(null);
      downRef.current = null;
      const c = carryRef.current;
      if (!c) return;
      carryRef.current = null;
      setCarry(null);
      const pos = c.spring.pos;
      const note = c.note;
      const dBet = Math.hypot(pos.x - worldSpot.x, pos.z - worldSpot.z);
      const dPledge = insurable ? Math.hypot(pos.x - pledgePos.x, pos.z - pledgePos.z) : Infinity;
      if (dPledge < PLEDGE_DROP_R && premium + note.value <= maxPledge) {
        setPledged(p => [...p, { ...note, spawn: [pos.x, pos.y, pos.z] }]);
        return;
      }
      if (dBet < BET_DROP_R) {
        setStaged(s => [...s, { ...note, spawn: [pos.x, pos.y, pos.z] }]);
        return;
      }
      // 没落进任何圈：飞回手里
      returnToHand(note, [pos.x, pos.y, pos.z]);
    };
    // pointerdown 用【捕获阶段】：必须在 r3f 的画布拾取（onHandDown）之前把 pressActiveRef 置真，
    // 否则快机正常按下时 onHandDown 先跑、读到假、直接 return，拖拽/拆分全失效。
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, worldSpot, pledgePos, insurable, premium, maxPledge]);

  const onFlightDone = (f) => {
    setFlights(fs => fs.filter(x => x.key !== f.key));
    if (f.note) setHand(h => [...h, { id: f.note.id, value: f.note.value }].sort((a, b) => b.value - a.value));
  };

  // 手牌按下（r3f 射线拾取，可能因慢机延迟）：先当长按拆分候选（移动超阈值转为拖拽，见 onMove）。
  // 若此刻真实按键已松开（pressActiveRef 为假，即拾取延迟到了 mouseup 之后），忽略——否则会误拆牌。
  const onHandDown = (note, e) => {
    if (!interactive || !pressActiveRef.current) return;
    downRef.current = { note, x: e.clientX, y: e.clientY };
    if (!SPLITS[note.value]) return;
    shakeTimer.current = setTimeout(() => { if (pressActiveRef.current) setShakingId(note.id); }, SHAKE_DELAY_MS);
    pressTimer.current = setTimeout(() => {
      if (!pressActiveRef.current || carryRef.current) return; // 已松开或已转为拖拽：不拆
      setShakingId(null);
      downRef.current = null;
      setHand(h => splitNote(h, note.id));
    }, LONG_PRESS_MS);
  };

  // 点圈里的牌：收回手中（飞行过渡）
  const unstage = (note) => {
    if (sent) return;
    setStaged(s => s.filter(n => n.id !== note.id));
    const idx = staged.findIndex(n => n.id === note.id);
    const l = cardLocal(Math.max(0, idx));
    const world = new THREE.Vector3(mySpot.x + l[0], l[1], mySpot.z + l[2]).applyAxisAngle(UP, rot);
    returnToHand(note, [world.x, world.y, world.z]);
  };
  const unpledge = (note) => {
    if (sent) return;
    const idx = pledged.findIndex(n => n.id === note.id);
    setPledged(p => p.filter(n => n.id !== note.id));
    const l = cardLocal(Math.max(0, idx));
    returnToHand(note, [pledgePos.x + l[0], l[1], pledgePos.z + l[2]]);
  };

  const confirm = () => {
    if (sent) return;
    if (bounds.forceAllIn) {
      // 全押：手牌整批飞进圆圈（走既有 FlyingNotes 管线，起点=3D 手牌投影到屏幕）
      const items = hand.map((n, i) => {
        const mesh = cardRefs.current.get(n.id);
        const v = new THREE.Vector3();
        if (mesh) mesh.getWorldPosition(v); else v.set(0, TABLE_TOP + 0.3, 2.2);
        v.project(camera);
        return {
          id: `bn-${Date.now()}-${i}`, value: n.value,
          fromScreen: { x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height },
        };
      });
      if (items.length) startBetFlight({ round: state.round, items });
      setHand([]);
      setSent(true);
      send({ type: 'place_bet', amount: me.balance, count: items.length, pledge: 0 });
      return;
    }
    if (!canConfirm) return;
    // 牌已在圆圈里：原地转正为 myStack（无飞行，服务端广播 hasBet 后由 Scene3D 无缝接管）
    placeTableStack({ round: state.round, notes: staged });
    if (pledged.length) {
      // 保单牌沉入桌下消失（不上桌不入注；金额随 place_bet.pledge 上报）
      setFlights(f => [...f, ...pledged.map((n, i) => {
        const l = cardLocal(i);
        return {
          key: `pl-${n.id}`, value: n.value,
          from: [pledgePos.x + l[0], l[1], pledgePos.z + l[2]],
          to: [pledgePos.x, TABLE_TOP - 0.7, pledgePos.z],
          shrinkOut: true,
        };
      })]);
      setPledged([]);
    }
    setSent(true);
    send({ type: 'place_bet', amount: total, count: staged.length, pledge: insurable ? premium : 0 });
  };
  useEffect(() => { confirmRef.current = confirm; });

  // Enter 确认（聊天/输入框聚焦时让位——与 2D MoneyHand 同规则）
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Enter' || chatOpen) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      confirmRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chatOpen]);

  useEffect(() => () => { clearTimers(); document.body.style.cursor = ''; }, []);

  const mid = (hand.length - 1) / 2;
  const spacing = Math.min(0.17, 1.15 / Math.max(hand.length, 1));

  // 圆圈浮字（白字无背景板）：金额/范围 + 确认行
  const line1 = bounds.forceAllIn
    ? `资金不足 · 必须全押 ¥${me.balance}`
    : `已选 ¥${total} · 可下注 ${bounds.min}-${effMax}${premium > 0 ? ` · 投保 ¥${premium}` : ''}`;
  const line2 = sent
    ? '已下注'
    : bounds.forceAllIn
      ? `全押 [Enter]`
      : canConfirm
        ? '确认下注 [Enter]'
        : (total < bounds.min ? '把手里的牌拖进圈里' : '超出上限');
  const line2Click = !sent && (bounds.forceAllIn || canConfirm);

  return (
    <group>
      {/* 相机跟随的手牌扇 */}
      <group ref={handGroup}>
        <group ref={handInner}>
          {hand.map((n, i) => (
            <HandCard
              key={n.id}
              note={n}
              i={i}
              mid={mid}
              spacing={spacing}
              shaking={shakingId === n.id}
              disabled={sent}
              onDown={onHandDown}
              register={(id, m) => { if (m) cardRefs.current.set(id, m); else cardRefs.current.delete(id); }}
            />
          ))}
        </group>
      </group>

      {/* 桌面侧（与场景同一旋转系）：暂存注 */}
      <group rotation={[0, rot, 0]}>
        {staged.map((n, i) => (
          <StagedCard key={n.id} note={n} i={i} spot={mySpot} rot={rot} onClick={unstage} />
        ))}
      </group>

      {/* 保留金：圆圈外右侧，正面朝上，不可交互 */}
      {reserveNotes.length > 0 && (
        <>
          <MoneyStack notes={reserveNotes} faceUp amount={bounds.minStake} labelColor="var(--ink-dim)" position={[reservePos.x, 0, reservePos.z]} />
          <Html position={[reservePos.x, stackTopY(reserveNotes.length) + 0.3, reservePos.z]} center distanceFactor={5} zIndexRange={[22, 0]}>
            <div className="felt-float"><PixelText size={2} color="var(--ink-dim)">保留金</PixelText></div>
          </Html>
        </>
      )}

      {/* 投保圈（仅投资人）：拖牌进圈=投保，点圈里的保单牌收回 */}
      {insurable && (
        <>
          <ZoneRing pos={pledgePos} opacity={carry ? 0.55 : 0.3} />
          {pledged.map((n, i) => (
            <PledgedCard key={n.id} note={n} i={i} pos={pledgePos} onClick={unpledge} />
          ))}
          <Html position={[pledgePos.x, TABLE_TOP + 0.52 + Math.min(pledged.length, 5) * 0.045, pledgePos.z]} center distanceFactor={6.5} zIndexRange={[22, 0]}>
            <div className="felt-float"><PixelText size={2} color={premium > 0 ? 'var(--px-gold)' : 'var(--ink-dim)'}>{`投保 ¥${premium}/${maxPledge}`}</PixelText></div>
          </Html>
        </>
      )}

      {/* 拖拽时点亮自己的下注圈 */}
      {carry && <ZoneRing pos={worldSpot} r={0.46} opacity={0.5} />}

      {/* 被抓着的牌 + 过渡飞牌 */}
      {carry && <CarriedNote note={carry.note} carryRef={carryRef} ndcRef={ndcRef} />}
      {flights.map(f => (
        <ArcNote key={f.key} value={f.value} from={f.from} to={f.to} duration={0.42} apex={0.55} shrinkOut={f.shrinkOut} onDone={() => onFlightDone(f)} />
      ))}

      {/* 圆圈上方浮字：白字提示（无背景板），确认行可点。
          我的圆圈离相机近，distanceFactor 压小一档才不至于糊满屏。 */}
      <Html position={[worldSpot.x, stackTopY(staged.length) + 0.42, worldSpot.z]} center distanceFactor={4.2} zIndexRange={[28, 0]}>
        <div className="felt-float">
          <PixelText size={2} color="#fff">{line1}</PixelText>
          {line2 && (
            line2Click
              ? <div className="clickable" onClick={() => confirmRef.current?.()}><PixelText size={2} color="var(--px-gold)">{line2}</PixelText></div>
              : <PixelText size={2} color="var(--ink-dim)">{line2}</PixelText>
          )}
        </div>
      </Html>
    </group>
  );
}

// 投保圈里的保单牌：正面朝上小堆，点击收回
function PledgedCard({ note, i, pos, onClick }) {
  const ref = useRef();
  const t0 = useRef(null);
  const from = useRef(note.spawn ? new THREE.Vector3(...note.spawn) : null);
  useFrame((st) => {
    const m = ref.current;
    if (!m) return;
    const l = cardLocal(i);
    const tx = pos.x + l[0], ty = l[1], tz = pos.z + l[2];
    if (from.current) {
      if (t0.current == null) t0.current = st.clock.elapsedTime;
      const t = Math.min(1, (st.clock.elapsedTime - t0.current) / 0.22);
      const e = 1 - (1 - t) * (1 - t);
      m.position.set(
        from.current.x + (tx - from.current.x) * e,
        from.current.y + (ty - from.current.y) * e,
        from.current.z + (tz - from.current.z) * e,
      );
      if (t >= 1) from.current = null;
    } else {
      m.position.set(tx, ty, tz);
    }
    m.rotation.set(0, cardYaw(i), 0);
  });
  return (
    <mesh
      ref={ref}
      material={cardMaterials(note.value)}
      castShadow
      onClick={(e) => { e.stopPropagation(); onClick(note); }}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { document.body.style.cursor = ''; }}
    >
      <boxGeometry args={[CARD_W, CARD_T, CARD_D]} />
    </mesh>
  );
}
