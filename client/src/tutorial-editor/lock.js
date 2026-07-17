// 多标签锁（§1.2）：BroadcastChannel('fate-tutorial-editor') 心跳。先开的标签持锁可编辑；
// 后开标签只读（store.ro=true，编辑动作被 store 的 RO_BLOCKED 守卫拦截），可点「夺锁」。
// 协议：hello(新标签问询) / held(持锁者应答) / ping(持锁心跳,1s) / seize(夺锁广播) / bye(持锁者退场)。
// 弱一致取舍（DEV 工具）：持锁者消失（bye 或心跳断流 3.5s）时，各只读标签延迟随机抖动后重新竞选，
// 先当选者靠心跳把慢一步的挤回只读（双持锁冲突按 id 字典序小者保锁），~1s 内收敛。
import { useEffect, useRef } from 'react';
import { useTedStore } from './store';

const CHANNEL = 'fate-tutorial-editor';

// 返回 {current:{seize}}：夺锁按钮经 ref 调用 effect 闭包里的实现（监听器只挂一次，活值经 getState）
export function useTabLock() {
  const api = useRef({ seize: () => {} });
  useEffect(() => {
    const apiObj = api.current; // effect 内快照（api 是稳定容器；cleanup 直接引 api.current 会吃 lint 警告）
    let bc;
    try { bc = new BroadcastChannel(CHANNEL); } catch { return undefined; } // 环境不支持 → 单标签，不上锁
    const id = Math.random().toString(36).slice(2);
    let holder = false, lastPing = 0, electT = 0, pingT = 0, epoch = 0; // epoch=本次持锁主张的起始时刻
    const st = () => useTedStore.getState();
    const post = (t) => { try { bc.postMessage({ t, id, epoch }); } catch { /* channel 已关 */ } };

    const becomeHolder = () => {
      holder = true;
      epoch = Date.now();
      st().setRo(false);
      clearInterval(pingT);
      pingT = setInterval(() => post('ping'), 1000);
      post('ping');
    };
    const becomeRo = () => {
      holder = false;
      st().setRo(true);
      clearInterval(pingT);
      lastPing = Date.now();
    };
    // 竞选：问一声有没有持锁者，静默 400ms+抖动 → 自己上位。初始态（limbo：ro=false 但也没心跳）
    // 不预设只读，避免首个标签闪一下只读横幅。
    const elect = () => {
      clearTimeout(electT);
      post('hello');
      electT = setTimeout(becomeHolder, 400 + Math.random() * 300);
    };

    bc.onmessage = ({ data }) => {
      if (!data || data.id === id) return;
      if (data.t === 'hello') { if (holder) post('held'); return; }
      if (data.t === 'held' || data.t === 'ping') {
        lastPing = Date.now();
        if (holder) {
          // 双持锁冲突（并发竞选 / 夺锁后撞上对方的**在途旧心跳**）：持锁主张按 epoch 新者胜——
          // 夺锁语义优先，旧心跳压不掉刚夺锁的标签（否则两边互退只读→看门狗重选，锁可能落回原标签，
          // 主线复跑 S13c 实测抓到此竞态）；同刻并列才按 id 字典序小者保锁。
          const theirs = data.epoch ?? 0;
          if (data.t === 'ping' && (theirs > epoch || (theirs === epoch && data.id < id))) becomeRo();
          return;
        }
        clearTimeout(electT); // 有人持锁 → 取消竞选
        if (!st().ro) st().setRo(true);
        return;
      }
      if (data.t === 'seize') { if (holder || !st().ro) becomeRo(); return; }
      if (data.t === 'bye') { if (!holder) setTimeout(elect, Math.random() * 250); }
    };

    // 看门狗：只读标签发现心跳断流（持锁者崩溃/被杀，来不及 bye）→ 重新竞选
    const watchT = setInterval(() => {
      if (!holder && st().ro && Date.now() - lastPing > 3500) elect();
    }, 1000);
    const onUnload = () => { if (holder) post('bye'); };
    window.addEventListener('beforeunload', onUnload);

    apiObj.seize = () => { post('seize'); becomeHolder(); };
    elect();

    return () => {
      clearTimeout(electT);
      clearInterval(pingT);
      clearInterval(watchT);
      window.removeEventListener('beforeunload', onUnload);
      if (holder) post('bye'); // StrictMode 假卸载也会走到：随后的真挂载立刻重新竞选，幂等
      bc.close();
      apiObj.seize = () => {};
    };
  }, []);
  return api;
}
