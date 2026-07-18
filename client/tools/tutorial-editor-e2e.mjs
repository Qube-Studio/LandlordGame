// 教程编辑器 2.0 持久 E2E 验收套件（EDITOR_OVERHAUL §1.3 全项）。
// 用法：node tools/tutorial-editor-e2e.mjs   （在 client/ 或仓库根都可跑；自起自杀 vite 5219）
//
// 隔离纪律（§1.1）：绝不写真 tutorial.json / 真 public/tutorial/——每次跑前把真文档拷进系统临时目录，
// 经 TUTORIAL_DOC_FILE / TUTORIAL_IMG_DIR 环境变量重定向给自带的 vite 实例；收尾断言真文件无测试串。
// 每次运行都重新拷贝副本（复跑残留副本会让草稿检测/字节对比失真——T②b 期踩过的坑）。
//
// E2E 纪律（§0.6）与历次施工踩过的坑，改本文件前必读：
//  ① SwiftShader flags 必带；断言一律轮询（until），固定等待必闪断。
//  ② 批删 confirm 的计数 = 「祖先吸收后代」归一化后的所选子树章节数，不是全树数。
//  ③ 预览滚动跟随的滚动者是 .ted-preview 里的 .tut-content（游戏面板内滚），不是 .ted-preview 外壳。
//  ④ 打字合并是 700ms 时基窗口，慢机上连续击键可合法拆成多步——断言记录实际步数 N、撤 N 步验完全还原。
//  ⑤ page.reload 前必须挂 page.once('dialog') accept，否则 beforeunload 弹框被 Playwright 默认
//     dismiss = 取消刷新，后续断言全部悬空。
//  ⑥ 校验面板在真库副本上可能有真实问题（用户占位空章节等）——只断言本套件自己制造的问题行，不数总数。
//  ⑦ 章/段计数、树结构相关断言全部从 store 动态算，不写死（真文档随用户编辑漂移）。
//  ⑧ 锁竞选与 StrictMode 假卸载会让标签竞选两次——锁相关断言轮询到稳态，不取瞬时值。
//  ⑨ Windows 下杀 vite 要 taskkill /T 连子进程一起（npx 包一层壳，kill 父进程子进程会存活）。
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5219;
const BASE = `http://localhost:${PORT}`;
const EDITOR_URL = `${BASE}/tutorial-editor.html`;
const REAL_DOC = path.join(CLIENT, 'src/text/tutorial.json');
const REAL_IMG = path.join(CLIENT, 'public/tutorial');
const SHOT = path.join(CLIENT, 'tools/tutorial-editor-e2e.png');

// 隔离副本（系统临时目录；每次运行清掉重建）
const TMP = path.join(os.tmpdir(), 'fate-ted-e2e');
const ISO_DOC = path.join(TMP, 'tutorial.json');
const ISO_IMG = path.join(TMP, 'img');

// 渲染器一致性夹具（S14）：覆盖全部段落形态；标题只用 CJK（PixelText 的 ASCII 走 SVG 无 textContent）
const FIXTURE = [
  {
    id: 'fx1',
    title: '夹具甲',
    body: [
      '普通段落文字',
      '**金字**与普通混排',
      '- 列表项目一',
      '',
      { text: '小号文字', size: 's' },
      { text: '大号文字', size: 'l' },
      { text: '特大文字', size: 'xl' },
    ],
    children: [
      {
        id: 'fx2',
        title: '夹具乙',
        body: [
          { img: '/tutorial/fx-e2e-nonexist.png', alt: '占位图' },
          { bar: '**攻击**强度', width: 120, fill: 40, color: 'red', fade: 'left' },
          { bar: '', width: 60, fill: 100, color: 'blue', fade: 'none' },
          { bar: '旧式条', value: 3, max: 6 },
        ],
        children: [],
      },
    ],
  },
];

// 收尾要在真文件里搜的测试串（任何一个出现在真 tutorial.json = 隔离被击穿，红灯）
const MARKERS = ['E2E甲', 'E2E块', '草稿X', '弃稿Y', '夹具甲', '夹具乙', '外部改动', '滚动行', '未知字段块'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const pass = (name) => { passed++; console.log(`  PASS ${name}`); };
const expect = (cond, name, detail) => {
  if (!cond) throw new Error(`断言失败：${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)?.slice(0, 400)}` : ''}`);
  pass(name);
};
// 轮询断言（坑①）：fn 返回真值即过；超时抛出并附最后一次取值
async function until(fn, name, timeout = 20000, step = 150) {
  const t0 = Date.now();
  let last;
  for (;;) {
    try { last = await fn(); if (last) { pass(name); return last; } } catch (e) { last = String(e.message || e); }
    if (Date.now() - t0 > timeout) {
      throw new Error(`轮询超时：${name} —— 最后取值 ${JSON.stringify(last)?.slice(0, 400)}`);
    }
    await sleep(step);
  }
}
const S = (title) => console.log(`\n== ${title}`);

// ---- 隔离副本与 vite ----
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(ISO_IMG, { recursive: true });
const ORIG_BYTES = fs.readFileSync(REAL_DOC); // 运行起点的真文档快照（真文件可能被用户随时改，此后只与快照比）
fs.writeFileSync(ISO_DOC, ORIG_BYTES);
const realImgBefore = new Set(fs.existsSync(REAL_IMG) ? fs.readdirSync(REAL_IMG) : []);

// 端口占用先检——别把别人的 vite 当成自己的
const portBusy = await fetch(BASE, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
if (portBusy) { console.error(`端口 ${PORT} 已被占用——本套件要自起自杀专属 vite，请先停掉占用者`); process.exit(1); }

const viteLog = [];
const vite = spawn('npx vite --port 5219 --strictPort', {
  cwd: CLIENT,
  shell: true,
  env: {
    ...process.env,
    VITE_CACHE_DIR: 'node_modules/.vite-t', // T 轨专属缓存（§3 端口纪律，防双轨 EPERM 竞态）
    TUTORIAL_DOC_FILE: ISO_DOC,
    TUTORIAL_IMG_DIR: ISO_IMG,
  },
});
vite.stdout.on('data', (d) => viteLog.push(String(d)));
vite.stderr.on('data', (d) => viteLog.push(String(d)));
const killVite = () => {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/PID', String(vite.pid)]); // 坑⑨
    else vite.kill('SIGKILL');
  } catch { /* 已退出 */ }
};

let browser = null;
let failShot = null;
try {
  await until(async () => (await fetch(EDITOR_URL, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false)),
    'vite 5219 就绪（隔离副本 env 已注入）', 60000, 400);

  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  // 低配/低内存下 SwiftShader 页面加载可超 30s（主线复跑实测终态段 goto 超时）——导航时窗放宽
  ctx.setDefaultNavigationTimeout(90000);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  // 页内速记：st=store 状态、byTitle=按标题找章节、counts=章/段计数（addInitScript 每次导航都重建）
  await ctx.addInitScript(() => {
    window.__h = {
      st: () => window.__tedStore.getState(),
      byTitle: (t) => {
        const walk = (ns) => { for (const n of ns || []) { if (n.title === t) return n; const r = walk(n.children); if (r) return r; } return null; };
        return walk(window.__tedStore?.getState().chapters);
      },
      counts: () => {
        let ch = 0, bl = 0;
        const walk = (n) => { ch += 1; bl += n.body.length; (n.children || []).forEach(walk); };
        (window.__tedStore.getState().chapters || []).forEach(walk);
        return { ch, bl };
      },
    };
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)));
  failShot = async () => { try { await page.screenshot({ path: path.join(TMP, 'fail.png') }); console.error('失败现场截图 →', path.join(TMP, 'fail.png')); } catch { /* 页已关 */ } };

  const st = (expr, arg) => page.evaluate(expr, arg); // 语义糖：页内求值（第二参必须转发——漏了它所有带参求值都静默拿到 undefined）
  const ready = () => until(() => st(() => window.__tedStore?.getState().status === 'ready' && !!window.__tedStore.getState().chapters), '编辑器载入完成');
  const undo = (n = 1) => st((k) => { for (let i = 0; i < k; i++) window.__h.st().undo(); }, n);
  const uidOf = (title) => st((t) => window.__h.byTitle(t)?.uid ?? null, title);
  const stubConfirm = () => st(() => { window.__confirms = []; window.confirm = (m) => { window.__confirms.push(m); return true; }; });
  const acceptUnload = () => {
    let type = null;
    page.once('dialog', (d) => { type = d.type(); d.accept(); }); // 坑⑤
    return () => type;
  };

  // ---------------- S1 载入 / 状态栏 / 纯净性 / 无浮雕 ----------------
  S('S1 载入·状态栏·模块图纯净性·无浮雕 chrome');
  await page.goto(EDITOR_URL);
  await ready();
  await st(() => localStorage.clear()); // 抹掉历史运行的草稿/栏宽，从已知态起步
  await page.reload();
  await ready();
  {
    const bar = await st(() => [...document.querySelectorAll('.ted-statusbar span')].map((e) => e.textContent));
    const expPath = path.relative(path.resolve(CLIENT, '..'), ISO_DOC).replace(/\\/g, '/');
    expect(bar[0] === expPath, 'S1a 状态栏路径 = 隔离副本（env 重定向生效）', bar[0]);
    const { ch, bl } = await st(() => window.__h.counts());
    expect(bar[1] === `${ch} 章 · ${bl} 段`, `S1b 状态栏计数动态一致（${ch} 章 ${bl} 段）`, bar[1]);
    await until(() => st(() => document.querySelectorAll('.ted-statusbar span')[2].textContent === '可编辑'), 'S1c 单标签持锁 → 可编辑');
    expect(bar[3] === '已保存', 'S1d 初始保存态 = 已保存', bar[3]);
    // 纯净性：编辑器模块图严禁触达 text/*、gameStore、tutorial.json（否则保存即自我 full-reload）
    const dirty = await st(() => performance.getEntriesByType('resource')
      .map((r) => r.name)
      .filter((n) => n.includes('/src/text/') || n.includes('gameStore') || n.includes('tutorial.json')));
    expect(dirty.length === 0, 'S1e 模块图纯净：无 text/* · gameStore · tutorial.json', dirty);
    // 无浮雕（§1.1）：编辑器 chrome 一律扁平，computedStyle 不得含 inset box-shadow
    const bevel = await st(() => ['.ted-btn', '.ted-toolbar', '.ted-input', '.ted-statusbar', '.ted-tree-item', '.ted-block']
      .flatMap((sel) => [...document.querySelectorAll(sel)].slice(0, 8)
        .map((el) => ({ sel, bs: getComputedStyle(el).boxShadow }))
        .filter((x) => x.bs.includes('inset'))));
    expect(bevel.length === 0, 'S1f 无浮雕：chrome 元素 box-shadow 均无 inset', bevel);
  }

  // ---------------- S2 文件往返 / 无自我 reload / 409 冲突流 ----------------
  S('S2 真文件字节往返·保存不自我 reload·409 冲突流');
  await st(() => { window.__tedProbe = 'alive'; });
  await page.keyboard.press('Control+KeyS');
  await until(() => st(() => window.__tedStore.getState().status === 'ready' && !window.__tedStore.getState().dirty), 'S2a Ctrl+S 保存完成');
  expect(fs.readFileSync(ISO_DOC).equals(ORIG_BYTES), 'S2b 载入→不动→保存：磁盘逐字节等于原文档（= git diff 空）');
  expect(await st(() => window.__tedProbe === 'alive'), 'S2c 保存后无自我 reload（window 探针存活）');

  const rootTitle0 = await st(() => window.__h.st().chapters[0].title);
  await page.click('.ted-title-field input');
  await page.keyboard.press('End');
  await page.keyboard.type(' E2E改');
  await until(() => st(() => window.__tedStore.getState().dirty), 'S2d 编辑 → dirty');
  await page.keyboard.press('Control+KeyS');
  await until(async () => !(await st(() => window.__tedStore.getState().dirty)), 'S2e 编辑后保存完成');
  {
    const txt = fs.readFileSync(ISO_DOC, 'utf8');
    expect(txt.includes(' E2E改'), 'S2f 编辑写入磁盘');
    expect(txt === JSON.stringify(JSON.parse(txt), null, 2) + '\n', 'S2g 落盘格式 = JSON.stringify(,null,2)+\\n');
    expect(await st(() => window.__tedProbe === 'alive'), 'S2h 编辑保存后仍无自我 reload');
  }
  // 409：外部改盘 → 保存必须弹「磁盘已被修改」；三条出路（取消/强制覆盖/重新载入）各验一遍
  const extWrite = (mut) => {
    const doc = JSON.parse(fs.readFileSync(ISO_DOC, 'utf8'));
    mut(doc);
    fs.writeFileSync(ISO_DOC, JSON.stringify(doc, null, 2) + '\n');
  };
  extWrite((d) => { d.chapters[0].title = '外部改动一'; });
  await page.click('.ted-title-field input');
  await page.keyboard.type('X');
  await page.keyboard.press('Control+KeyS');
  await until(() => st(() => !!window.__tedStore.getState().conflict && !!document.querySelector('.ted-modal')), 'S2i 外部改盘 + 保存 → 409 冲突对话框');
  await page.click('.ted-modal .ted-btn:has-text("取消")');
  await until(() => st(() => !window.__tedStore.getState().conflict && window.__tedStore.getState().dirty), 'S2j 取消：冲突关闭、内存态未丢（仍 dirty）');
  await page.keyboard.press('Control+KeyS');
  await until(() => st(() => !!document.querySelector('.ted-modal')), 'S2k 再保存 → 再次 409');
  await page.click('.ted-modal .ted-btn:has-text("强制覆盖")');
  await until(async () => !(await st(() => window.__tedStore.getState().dirty)), 'S2l 强制覆盖完成');
  expect(!fs.readFileSync(ISO_DOC, 'utf8').includes('外部改动一'), 'S2m 强制覆盖：磁盘上的外部改动被编辑器内容顶掉');
  extWrite((d) => { d.chapters[0].title = '外部改动二'; });
  await page.click('.ted-title-field input');
  await page.keyboard.type('Y');
  await page.keyboard.press('Control+KeyS');
  await until(() => st(() => !!document.querySelector('.ted-modal')), 'S2n 第三次 409');
  await page.click('.ted-modal .ted-btn:has-text("重新载入")');
  await until(() => st(() => window.__tedStore.getState().chapters?.[0]?.title === '外部改动二' && !window.__tedStore.getState().dirty),
    'S2o 重新载入：磁盘外部版本换入、丢弃未保存编辑');
  // 收拾现场：把首章标题改回运行起点值再落盘，后续断言不受污染
  await st((t) => { const s = window.__h.st(); s.setTitle(s.chapters[0].uid, t); }, rootTitle0);
  await page.keyboard.press('Control+KeyS');
  await until(async () => !(await st(() => window.__tedStore.getState().dirty)), 'S2p 现场复原并保存');

  // ---------------- S3 树多选 + 祖先吸收后代 ----------------
  S('S3 树多选（Ctrl/Shift/主选）·祖先吸收后代');
  await stubConfirm();
  // 脚手架（store 动作 = 与 UI 同一入口）：E2E甲 → 甲1..甲4，甲2 下再挂 甲2x
  await st(() => {
    const s = window.__h.st();
    s.addTopChapter();
    const root = window.__h.st().selUid;
    window.__h.st().setTitle(root, 'E2E甲');
    for (const t of ['甲1', '甲2', '甲3', '甲4']) {
      window.__h.st().addChildChapter(root);
      window.__h.st().setTitle(window.__h.st().selUid, t);
    }
    const jia2 = window.__h.byTitle('甲2').uid;
    window.__h.st().addChildChapter(jia2);
    window.__h.st().setTitle(window.__h.st().selUid, '甲2x');
  });
  const U = {};
  for (const t of ['E2E甲', '甲1', '甲2', '甲2x', '甲3', '甲4']) U[t] = await uidOf(t);
  const row = (t) => `.ted-tree-item[data-uid="${U[t]}"]`;
  await until(() => st((u) => !!document.querySelector(`.ted-tree-item[data-uid="${u}"]`), U['甲2x']), 'S3a 脚手架就绪（树行可见）');
  await page.click(row('甲1'));
  await page.click(row('甲3'), { modifiers: ['Control'] });
  {
    const s = await st(() => ({ sel: window.__h.st().selChUids, p: window.__h.st().selUid, title: document.querySelector('.ted-title-field input').value }));
    expect(s.sel.length === 2 && s.p === U['甲3'], 'S3b Ctrl 加选：[甲1,甲3] 主选=甲3', s);
    expect(s.title === '甲3', 'S3c 中栏恒显主选章节', s.title);
  }
  await page.click(row('甲3'), { modifiers: ['Control'] });
  expect((await st(() => window.__h.st().selUid)) === U['甲1'], 'S3d Ctrl 再点移除：主选退回甲1');
  await page.click(row('甲1'));
  await page.click(row('甲4'), { modifiers: ['Shift'] });
  {
    const s = await st(() => ({ sel: window.__h.st().selChUids, p: window.__h.st().selUid }));
    expect(s.sel.length === 5 && s.p === U['甲4'], 'S3e Shift 范围沿可见序（含展开的甲2x）共 5 行，主选=甲4', s);
  }
  // 祖先吸收：E2E甲 + 其孙 甲2x 同选 → Ctrl+D 只克隆整棵 E2E甲 一次
  await page.click(row('E2E甲'));
  await page.click(row('甲2x'), { modifiers: ['Control'] });
  await page.keyboard.press('Control+KeyD');
  {
    const s = await st(() => {
      const tops = window.__h.st().chapters.filter((c) => c.title === 'E2E甲（副本）');
      return { n: tops.length, kids: tops[0]?.children.length ?? -1 };
    });
    expect(s.n === 1 && s.kids === 4, 'S3f 祖先吸收后代：Ctrl+D 只克隆整棵 E2E甲（副本子级=4）', s);
  }
  await undo();
  expect(await st(() => window.__h.st().chapters.every((c) => c.title !== 'E2E甲（副本）')), 'S3g 一步撤回清副本');

  // ---------------- S4 树键盘导航 ----------------
  S('S4 树键盘：↑↓可见序·←→收展·F2 重命名·IME 直通·Del 批删规则·Ctrl+D');
  await page.click(row('甲1')); // rowClick 把焦点交给树容器
  await page.keyboard.press('ArrowDown');
  expect((await st(() => window.__h.st().selUid)) === U['甲2'], 'S4a ↓ → 甲2');
  await page.keyboard.press('ArrowDown');
  expect((await st(() => window.__h.st().selUid)) === U['甲2x'], 'S4b ↓ 进入展开的子级 甲2x');
  await page.keyboard.press('ArrowUp');
  expect((await st(() => window.__h.st().selUid)) === U['甲2'], 'S4c ↑ 回 甲2');
  await page.keyboard.press('ArrowLeft');
  expect(!(await st((u) => window.__h.st().openUids.has(u), U['甲2'])), 'S4d ← 收起 甲2');
  await page.keyboard.press('ArrowDown');
  expect((await st(() => window.__h.st().selUid)) === U['甲3'], 'S4e 收起后 ↓ 跳过隐藏子级 → 甲3');
  await page.click(row('甲2'));
  await page.keyboard.press('ArrowRight');
  expect(await st((u) => window.__h.st().openUids.has(u), U['甲2']), 'S4f → 重新展开 甲2');
  // F2 行内重命名（Enter 提交）
  await page.keyboard.press('F2');
  await until(() => st(() => !!document.querySelector('.ted-rename')), 'S4g F2 出现行内重命名框');
  await page.keyboard.type('甲2改');
  await page.keyboard.press('Enter');
  await until(() => st((u) => window.__h.st().chapters && window.__h.byTitle('甲2改')?.uid === u, U['甲2']), 'S4h Enter 提交重命名');
  U['甲2改'] = U['甲2'];
  // IME 直通：keyCode 229 的 F2、isComposing 的 ↓ 均不得触发结构动作
  await st(() => {
    const body = document.querySelector('.ted-tree-body');
    const e = new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true });
    Object.defineProperty(e, 'keyCode', { get: () => 229 });
    body.dispatchEvent(e);
    body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', isComposing: true, bubbles: true, cancelable: true }));
  });
  await sleep(300);
  expect(await st((u) => !document.querySelector('.ted-rename') && window.__h.st().selUid === u, U['甲2']),
    'S4i IME 合成期 F2/↓ 直通（无重命名框、选择不动）');
  // Del：<5 章不 confirm 直删（撤回兜底）；≥5 章 confirm 且计数=归一化子树（坑②）
  await page.click(row('甲3'));
  await page.keyboard.press('Delete');
  expect(await st(() => !window.__h.byTitle('甲3') && window.__confirms.length === 0), 'S4j 单章 Del：不 confirm 直删');
  await undo();
  U['甲3'] = await uidOf('甲3');
  await page.click(`.ted-tree-item[data-uid="${U['E2E甲']}"]`);
  await page.keyboard.press('Delete');
  await until(() => st(() => window.__confirms.length === 1 && !window.__h.byTitle('E2E甲')), 'S4k 大子树 Del：confirm 一次并删除');
  expect((await st(() => window.__confirms[0])).includes('6'), 'S4l confirm 计数 = 所选子树 6 章（非全树）');
  await undo();
  for (const t of ['E2E甲', '甲1', '甲2改', '甲2x', '甲3', '甲4']) U[t] = await uidOf(t);
  expect(Object.values(U).every(Boolean), 'S4m 撤回复活整棵 E2E甲');
  await page.click(`.ted-tree-item[data-uid="${U['甲3']}"]`);
  await page.keyboard.press('Control+KeyD');
  expect(await st(() => !!window.__h.byTitle('甲3（副本）')), 'S4n Ctrl+D 单章副本');
  await undo();

  // ---------------- S5 多选拖拽整组 ----------------
  S('S5 多选 HTML5 拖拽整组·拖进自身后代被拒');
  for (const t of ['E2E甲', '甲1', '甲2改', '甲2x', '甲3', '甲4']) U[t] = await uidOf(t);
  await page.click(`.ted-tree-item[data-uid="${U['甲1']}"]`);
  await page.click(`.ted-tree-item[data-uid="${U['甲3']}"]`, { modifiers: ['Control'] });
  await page.evaluate(async ({ src, tgt }) => {
    // 合成 DnD：每步 90ms、dragover 发两次（第一次种 dropRef，第二次稳定 zone）——SwiftShader 慢帧下的保险
    const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
    const el = (u) => document.querySelector(`.ted-tree-item[data-uid="${u}"]`);
    const dt = new DataTransfer();
    const fire = (node, type, extra = {}) => node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, ...extra }));
    fire(el(src), 'dragstart'); await sleep2(90);
    const r = el(tgt).getBoundingClientRect();
    const at = { clientX: r.left + 12, clientY: r.bottom - 2 }; // 下 1/4 = after
    fire(el(tgt), 'dragover', at); await sleep2(90);
    fire(el(tgt), 'dragover', at); await sleep2(90);
    fire(el(tgt), 'drop', at); await sleep2(60);
    fire(el(src) || document.body, 'dragend');
  }, { src: U['甲1'], tgt: U['甲4'] });
  await until(() => st((root) => {
    const n = window.__h.st().chapters.find((c) => c.uid === root);
    return JSON.stringify(n.children.map((c) => c.title)) === JSON.stringify(['甲2改', '甲4', '甲1', '甲3']);
  }, U['E2E甲']), 'S5a 拖 2 个非连续子级到甲4之后：落点保持相对顺序');
  await undo();
  expect(await st((root) => {
    const n = window.__h.st().chapters.find((c) => c.uid === root);
    return JSON.stringify(n.children.map((c) => c.title)) === JSON.stringify(['甲1', '甲2改', '甲3', '甲4']);
  }, U['E2E甲']), 'S5b 整组移动一步撤回还原');
  await st(({ root, tgt }) => window.__h.st().moveChapters([root], tgt, 'into'), { root: U['E2E甲'], tgt: U['甲2x'] });
  expect(await st((root) => window.__h.st().chapters.some((c) => c.uid === root), U['E2E甲']),
    'S5c 拖进自身后代被 store 再校验拒绝（结构不变）');

  // ---------------- S6 块多选 / 拆并段 / IME 合成（CDP） / Alt+↑↓ ----------------
  S('S6 块多选·Enter 拆段·行首 Backspace 并段·CDP IME 合成中 Enter 不拆段·Alt+↑↓');
  await st(() => {
    const s = window.__h.st();
    s.addTopChapter();
    const u = window.__h.st().selUid;
    window.__h.st().setTitle(u, 'E2E块');
    window.__h.st().pasteBlocks(u, null, ['块一', '块二', '块三', '块四']);
    window.__h.st().select(u);
  });
  const chBlk = await uidOf('E2E块');
  const blkUids = () => st((t) => window.__h.byTitle(t).body.map((b) => b.uid), 'E2E块');
  const blkTexts = () => st((t) => window.__h.byTitle(t).body.map((b) => (typeof b.data === 'string' ? b.data : (b.data.text ?? JSON.stringify(b.data)))), 'E2E块');
  let B = await blkUids();
  const kindOf = (u) => `[data-blk-uid="${u}"] .ted-block-kind`;
  await page.click(kindOf(B[0]));
  await page.click(kindOf(B[2]), { modifiers: ['Control'] });
  {
    const s = await st((b) => ({
      sel: window.__h.st().selBlks,
      pCls: document.querySelector(`[data-blk-uid="${b[2]}"]`).className.includes('primary'),
      mCls: document.querySelector(`[data-blk-uid="${b[0]}"]`).className.includes('sel'),
    }), B);
    expect(s.sel.length === 2 && s.pCls && s.mCls, 'S6a 块 Ctrl 多选：主选 primary、其余 sel 视觉', s);
  }
  await page.click(kindOf(B[3]), { modifiers: ['Shift'] });
  expect((await st(() => window.__h.st().selBlks)).length === 2, 'S6b 块 Shift 范围（锚=上个主选块三 → 块四）');
  // Enter 拆段
  await page.click(`[data-blk-uid="${B[1]}"] textarea`);
  await st((u) => { const ta = document.querySelector(`[data-blk-uid="${u}"] textarea`); ta.setSelectionRange(1, 1); }, B[1]);
  await page.keyboard.press('Enter');
  await until(async () => JSON.stringify(await blkTexts()) === JSON.stringify(['块一', '块', '二', '块三', '块四']), 'S6c Enter 光标处拆段');
  await until(() => st(() => {
    const ae = document.activeElement;
    return ae?.tagName === 'TEXTAREA' && ae.closest('[data-blk-uid]') && ae.value === '二' && ae.selectionStart === 0;
  }), 'S6d 焦点落新段行首');
  // 行首 Backspace 并段
  await page.keyboard.press('Backspace');
  await until(async () => JSON.stringify(await blkTexts()) === JSON.stringify(['块一', '块二', '块三', '块四']), 'S6e 行首 Backspace 并回上一段');
  expect(await st(() => document.activeElement?.value === '块二' && document.activeElement.selectionStart === 1), 'S6f 并段焦点落接缝处');
  // CDP 真 IME：合成中 Enter 不拆段（§1.3 指定 Input.imeSetComposition）
  B = await blkUids();
  await page.click(`[data-blk-uid="${B[2]}"] textarea`);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: '拼音', selectionStart: 2, selectionEnd: 2 });
  await page.keyboard.press('Enter');
  await sleep(600); // 负向断言需要一个稳定窗口
  expect((await blkTexts()).length === 4, 'S6g CDP IME 合成中 Enter 不拆段');
  await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 }); // 取消合成
  await st(({ ch, u }) => window.__h.st().setBlockText(ch, u, '块三', null), { ch: chBlk, u: B[2] }); // 清掉合成残留
  // 合成 keyCode 229 的 Enter 同样直通
  await st((u) => {
    const ta = document.querySelector(`[data-blk-uid="${u}"] textarea`);
    ta.focus();
    const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(e, 'keyCode', { get: () => 229 });
    ta.dispatchEvent(e);
  }, B[1]);
  await sleep(300);
  expect((await blkTexts()).length === 4, 'S6h keyCode 229 的 Enter 直通不拆段');
  // Alt+↑↓ 移动（焦点在块内输入框）
  await page.click(`[data-blk-uid="${B[0]}"] textarea`);
  await page.keyboard.press('Alt+ArrowDown');
  await until(async () => JSON.stringify(await blkTexts()) === JSON.stringify(['块二', '块一', '块三', '块四']), 'S6i Alt+↓ 下移块');
  await page.keyboard.press('Alt+ArrowUp');
  await until(async () => JSON.stringify(await blkTexts()) === JSON.stringify(['块一', '块二', '块三', '块四']), 'S6j Alt+↑ 移回');

  // ---------------- S7 剪贴板：信封 + 粘贴裁决四档 ----------------
  S('S7 剪贴板信封（章节/块/剪切）·粘贴裁决：图片>信封>多行拆段>单行默认');
  const fireCopy = (type = 'copy') => st((tp) => {
    const dt = new DataTransfer();
    const ev = new ClipboardEvent(tp, { clipboardData: dt, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    return { txt: dt.getData('text/plain'), prevented: ev.defaultPrevented };
  }, type);
  const firePaste = (text) => st((t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, text);
  // 章节信封（树持焦）+ 复制同样做祖先归一化
  await page.click(`.ted-tree-item[data-uid="${U['E2E甲']}"]`);
  await page.click(`.ted-tree-item[data-uid="${U['甲2x']}"]`, { modifiers: ['Control'] });
  {
    const r = await fireCopy();
    const env = JSON.parse(r.txt);
    expect(r.prevented && env.fmt === 'fate-tutorial-chapters', 'S7a 树持焦 Ctrl+C → 章节信封');
    expect(env.chapters.length === 1 && env.chapters[0].title === 'E2E甲' && env.chapters[0].children.length === 4,
      'S7b 复制信封做祖先吸收（只含整棵 E2E甲）', { n: env.chapters.length });
    // 粘贴章节信封（带尾换行仍按信封识别）：插到主选章节之后、全树 id 唯一
    await st((u) => { window.__h.st().select(u); document.activeElement?.blur?.(); }, U['E2E甲']);
    await firePaste(r.txt + '\n');
    const s = await st(() => {
      const cs = window.__h.st().chapters;
      const i = cs.findIndex((c) => c.title === 'E2E甲');
      const ids = [];
      const walk = (ns) => ns.forEach((n) => { ids.push(n.id); walk(n.children); });
      walk(cs);
      return { after: cs[i + 1]?.title, dup: ids.length !== new Set(ids).size, sel: window.__h.st().selChUids.length };
    });
    expect(s.after === 'E2E甲' && !s.dup && s.sel === 1, 'S7c 粘贴章节信封（含尾换行）：插主选后、id 全树唯一、选中新章', s);
    await undo();
  }
  // 块信封 + 剪切。先把编辑列切回 E2E块——上一步撤回把选择快照还原到别的章节，块 DOM 不在场
  const showBlk = async (tag) => {
    await st((u) => window.__h.st().select(u), chBlk);
    await until(() => st((t) => {
      const b = window.__h.byTitle(t).body[0];
      return !!b && !!document.querySelector(`[data-blk-uid="${b.uid}"]`);
    }, 'E2E块'), `${tag} 编辑列显示 E2E块`);
  };
  await showBlk('S7d0');
  B = await blkUids();
  await page.click(kindOf(B[0]));
  await page.click(kindOf(B[2]), { modifiers: ['Control'] });
  {
    const r = await fireCopy();
    const env = JSON.parse(r.txt);
    expect(r.prevented && env.fmt === 'fate-tutorial-blocks' && JSON.stringify(env.blocks) === JSON.stringify(['块一', '块三']),
      'S7d 块多选 Ctrl+C → 块信封（文档序）');
    const rc = await fireCopy('cut');
    expect(JSON.parse(rc.txt).blocks.length === 2 && JSON.stringify(await blkTexts()) === JSON.stringify(['块二', '块四']),
      'S7e Ctrl+X = 信封 + 删除');
    await undo();
    // 粘贴块信封 → 主选块之后 + 选中新块
    B = await blkUids();
    await page.click(kindOf(B[1]));
    await firePaste(JSON.stringify({ fmt: 'fate-tutorial-blocks', blocks: ['甲贴', '乙贴'] }));
    await until(async () => JSON.stringify(await blkTexts()) === JSON.stringify(['块一', '块二', '甲贴', '乙贴', '块三', '块四']), 'S7f 粘贴块信封落主选块后');
    expect((await st(() => window.__h.st().selBlks)).length === 2, 'S7g 粘贴后选中全部新块');
    await undo();
  }
  // 裁决③：无输入焦点的多行文本 → 拆段成块（去首尾空行、留中间空行）
  await st(() => document.activeElement?.blur?.());
  await firePaste('\n\n甲行\n\n乙行\n\n');
  await until(async () => JSON.stringify((await blkTexts()).slice(-3)) === JSON.stringify(['甲行', '', '乙行']), 'S7h 多行文本无焦点 → 章末拆段（中间空行保留）');
  await undo();
  // 裁决③（textarea 内）：光标处拆段
  B = await blkUids();
  await page.click(`[data-blk-uid="${B[1]}"] textarea`);
  await st((u) => document.querySelector(`[data-blk-uid="${u}"] textarea`).setSelectionRange(1, 1), B[1]);
  await firePaste('X\nY');
  await until(async () => JSON.stringify(await blkTexts()) === JSON.stringify(['块一', '块X', 'Y二', '块三', '块四']), 'S7i 块内多行粘贴 → 光标处拆段');
  await undo();
  // 裁决④：单行文本 → 不拦（浏览器默认入光标）
  B = await blkUids();
  await page.click(`[data-blk-uid="${B[0]}"] textarea`);
  expect((await firePaste('abc')) === false, 'S7j 单行文本 defaultPrevented=false 交浏览器默认');
  // 裁决①：图片文件优先于文本 → 追加图片块 + 入库（隔离 IMG_DIR），插块+填图一步撤回
  await st(() => { window.__tedProbe = 'alive'; document.activeElement?.blur?.(); });
  await st((u) => window.__h.st().select(u), chBlk);
  const preN = (await blkUids()).length;
  await st(() => {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'e2e.png', { type: 'image/png' }));
    dt.setData('text/plain', '行一\n行二'); // 同时带多行文本：图片必须赢
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const pastedImg = await until(() => st((t) => {
    const body = window.__h.byTitle(t).body;
    const last = body[body.length - 1].data;
    return last && typeof last === 'object' && /^\/tutorial\/paste-/.test(last.img || '') ? last.img : null;
  }, 'E2E块'), 'S7k 图片文件优先：追加图片块并回填入库 URL');
  const pastedName = pastedImg.split('/').pop();
  expect(fs.existsSync(path.join(ISO_IMG, pastedName)), 'S7l 图片落进隔离 TUTORIAL_IMG_DIR（非真图库）');
  await undo();
  expect((await blkUids()).length === preN, 'S7m 贴图「追加块+填图」一步撤回');
  expect(await st(() => window.__tedProbe === 'alive'), 'S7n 上传后无自我 reload（探针存活）');

  // ---------------- S8 右键菜单 ----------------
  S('S8 右键菜单：树/块·三种关闭·navigator.clipboard 路径');
  await page.click(`.ted-tree-item[data-uid="${U['甲1']}"]`);
  await page.click(`.ted-tree-item[data-uid="${U['甲3']}"]`, { button: 'right' });
  await until(() => st((u) => !!document.querySelector('.ted-menu') && JSON.stringify(window.__h.st().selChUids) === JSON.stringify([u]), U['甲3']),
    'S8a 右键未选中行：菜单出现且选择切换到该行');
  expect(await st(() => {
    const items = [...document.querySelectorAll('.ted-menu-item')].map((e) => e.textContent);
    return items.some((t) => t.includes('重命名') && t.includes('F2')) && items.some((t) => t.includes('删除'));
  }), 'S8b 菜单含 重命名(F2)/删除');
  await page.keyboard.press('Escape');
  await until(() => st(() => !document.querySelector('.ted-menu')), 'S8c Esc 关菜单');
  await page.click(`.ted-tree-item[data-uid="${U['甲3']}"]`, { button: 'right' });
  await until(() => st(() => !!document.querySelector('.ted-menu')), 'S8d 重开菜单');
  await page.mouse.click(1400, 860); // 菜单外 mousedown
  await until(() => st(() => !document.querySelector('.ted-menu')), 'S8e 外点关菜单');
  await page.click(`.ted-tree-item[data-uid="${U['甲3']}"]`, { button: 'right' });
  await until(() => st(() => !!document.querySelector('.ted-menu')), 'S8f 再开菜单');
  await st(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: 40 })));
  await until(() => st(() => !document.querySelector('.ted-menu')), 'S8g 滚轮关菜单');
  await page.click(`.ted-tree-item[data-uid="${U['甲3']}"]`, { button: 'right' });
  await page.click('.ted-menu-item:has-text("在其后插入章节")');
  await until(() => st((root) => {
    const n = window.__h.st().chapters.find((c) => c.uid === root);
    const i = n.children.findIndex((c) => c.title === '甲3');
    return n.children[i + 1]?.title === '新章节';
  }, U['E2E甲']), 'S8h 菜单动作：甲3 后插入新章节');
  await undo();
  // 块菜单：插属性条 / navigator.clipboard 复制+粘贴 / 批删
  await showBlk('S8i0');
  B = await blkUids();
  await page.click(kindOf(B[0]), { button: 'right' });
  await until(() => st(() => !!document.querySelector('.ted-menu')), 'S8i 块右键菜单出现');
  await page.click('.ted-menu-item:has-text("其后插入：属性条")');
  await until(() => st((t) => { const d = window.__h.byTitle(t).body[1]?.data; return d && typeof d === 'object' && 'bar' in d; }, 'E2E块'), 'S8j 其后插入属性条');
  await undo();
  B = await blkUids();
  await page.click(kindOf(B[0]));
  await page.click(kindOf(B[2]), { modifiers: ['Control'] });
  await page.click(kindOf(B[2]), { button: 'right' });
  await page.click('.ted-menu-item:has-text("复制 2 块")');
  await until(() => st(async () => {
    const t = await navigator.clipboard.readText();
    try { const o = JSON.parse(t); return o.fmt === 'fate-tutorial-blocks' && o.blocks.length === 2; } catch { return false; }
  }), 'S8k 菜单复制走 navigator.clipboard（信封 2 块）');
  await page.click(kindOf(B[2]), { button: 'right' });
  await page.click('.ted-menu-item:has-text("粘贴到其后")');
  await until(async () => JSON.stringify(await blkTexts()) === JSON.stringify(['块一', '块二', '块三', '块一', '块三', '块四']), 'S8l 菜单粘贴到其后');
  await undo();
  await page.click(kindOf(B[0]));
  await page.click(kindOf(B[2]), { modifiers: ['Control'] });
  await page.click(kindOf(B[2]), { button: 'right' });
  await page.click('.ted-menu-item:has-text("删除 2 块")');
  await until(async () => JSON.stringify(await blkTexts()) === JSON.stringify(['块二', '块四']), 'S8m 菜单批删 2 块');
  await undo();

  // ---------------- S9 校验面板 + 点击定位 ----------------
  S('S9 校验：空章节·未知字段·坏图（new Image 探活）·点击定位三处');
  await st((ch) => {
    const s = window.__h.st();
    s.addTopChapter(); // 空章节（标题「新章节」、无子无正文）
    window.__h.st().pasteBlocks(ch, null, [{ text: '未知字段块', foo: 1 }]);
    window.__h.st().insertBlock(ch, window.__h.byTitle('E2E块').body.length, { img: '/tutorial/e2e-404-probe.png' });
  }, chBlk);
  await page.click('.ted-toolbar .ted-btn:has-text("校验")');
  await until(() => st(() => {
    const rows = [...document.querySelectorAll('.ted-val-row')].map((e) => e.textContent);
    return rows.some((t) => t.includes('空章节') && t.includes('新章节'))
      && rows.some((t) => t.includes('未知字段') && t.includes('foo'))
      && rows.some((t) => t.includes('坏图') && t.includes('e2e-404-probe'));
  }), 'S9a 三类问题各自出现（坏图经探活异步出现）', 25000);
  await st(() => [...document.querySelectorAll('.ted-val-row')].find((e) => e.textContent.includes('e2e-404-probe')).click());
  await until(() => st((t) => {
    const ch2 = window.__h.byTitle(t);
    const blk = ch2.body[ch2.body.length - 1];
    return window.__h.st().selUid === ch2.uid
      && window.__h.st().selBlks[0] === blk.uid
      && document.querySelector(`[data-blk-uid="${blk.uid}"]`)?.className.includes('primary')
      && !!document.querySelector('.ted-preview .ted-flash');
  }, 'E2E块'), 'S9b 点击坏图行：树/编辑列/预览三处定位（primary + flash 高亮）');
  await page.click('.ted-valpanel-head .ted-btn:has-text("✕")');
  await until(() => st(() => !document.querySelector('.ted-valpanel')), 'S9c 校验面板关闭');
  await undo(3);
  expect(await st((t) => window.__h.byTitle(t).body.length === 4, 'E2E块'), 'S9d 撤回×3 清理制造的问题');

  // ---------------- S10 布局：三栏拖宽 + 预览/编辑列滚动跟随 ----------------
  S('S10 三栏拖宽（persist）·预览滚动跟随选中块');
  {
    const g = await page.locator('.ted-gutter').first().boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + 300);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2 + 60, g.y + 300, { steps: 5 });
    await page.mouse.up();
    await until(() => st(() => JSON.parse(localStorage.getItem('fate-ted-cols') || '{}').tree === 310), 'S10a 拖宽 250→310 并持久化 localStorage');
    expect((await st(() => getComputedStyle(document.querySelector('.ted-tree')).width)) === '310px', 'S10b 树栏实际宽度 310px');
  }
  await showBlk('S10c0'); // 预览/编辑列必须正显示 E2E块，粘 30 块才有可滚内容
  await st((ch) => window.__h.st().pasteBlocks(ch, null, Array.from({ length: 30 }, (_, i) => `滚动行${i + 1}`)), chBlk);
  await until(() => st(() => {
    const col = document.querySelector('.ted-editcol');
    // 编辑列不缩放、30 块必超高 → 选末块必滚（scrollTop>0）。
    // 预览面板按游戏满宽渲染、内容全展开、整体 zoom 适配（不模拟游戏面板内部滚动），滚动容器是外壳
    // .ted-preview——但内容 zoom 后未必超过预览列高，故跟随的本质断言=选中的末块落在预览可视区内可见。
    const prev = document.querySelector('.ted-preview');
    const uid = window.__tedStore.getState().selBlks.at(-1);
    const el = prev?.querySelector(`[data-ted-uid="${uid}"]`);
    if (!col || !el) return false;
    const er = el.getBoundingClientRect(), hr = prev.getBoundingClientRect();
    const visible = er.top < hr.bottom && er.bottom > hr.top; // 末块与预览视口相交=跟随到位
    return col.scrollTop > 0 && visible;
  }), 'S10c 粘 30 块选中末块：编辑列滚动跟随 + 预览末块可见');
  await undo();

  // ---------------- S11 撤回焦点恢复 / 打字合并 / memo 定标 ----------------
  S('S11 撤回焦点恢复·打字合并（时基容忍）·memo 渲染计数');
  await showBlk('S11-0');
  B = await blkUids();
  // 打字合并：记实际步数 N、撤 N 步完全还原（坑④）
  await page.click(`[data-blk-uid="${B[0]}"] textarea`);
  await page.keyboard.press('End');
  const p0 = await st(() => window.__h.st().past.length);
  await page.keyboard.type('abc');
  await until(async () => (await blkTexts())[0] === '块一abc', 'S11a 连续键入落店');
  const steps = (await st(() => window.__h.st().past.length)) - p0;
  await undo(steps);
  expect((await blkTexts())[0] === '块一' && (await st(() => window.__h.st().past.length)) === p0,
    `S11b 打字合并成 ${steps} 步（700ms 时基），撤 ${steps} 步完全还原`);
  // 焦点恢复：打字→移焦→Ctrl+Z 光标回原块
  await page.click(`[data-blk-uid="${B[1]}"] textarea`);
  await page.keyboard.press('End');
  await page.keyboard.type('Z');
  await until(async () => (await blkTexts())[1] === '块二Z', 'S11c 键入 Z');
  await page.click('.ted-tree-body');
  await page.keyboard.press('Control+KeyZ');
  await until(() => st((u) => {
    const ae = document.activeElement;
    return ae?.tagName === 'TEXTAREA' && ae.closest('[data-blk-uid]')?.dataset.blkUid === u && ae.value === '块二';
  }, B[1]), 'S11d 撤回后文本还原且焦点/光标回到该块');
  // memo 定标：编辑一个块，其他块与树行渲染计数不动
  {
    const rc0 = await st(() => JSON.parse(JSON.stringify(window.__tedRC || {})));
    await page.click(`[data-blk-uid="${B[0]}"] textarea`);
    await page.keyboard.press('End');
    await page.keyboard.type('Q');
    await until(async () => (await blkTexts())[0] === '块一Q', 'S11e 键入 Q');
    const d = await st(({ rc0: r0, b0, b1, t0 }) => {
      const rc = window.__tedRC || {};
      const delta = (k) => (rc[k] || 0) - (r0[k] || 0);
      return { self: delta('b:' + b0), other: delta('b:' + b1), tree: delta('t:' + t0) };
    }, { rc0, b0: B[0], b1: B[1], t0: U['E2E甲'] });
    expect(d.self > 0 && d.other === 0 && d.tree === 0, 'S11f memo：编辑块自身重渲、邻块/树行零重渲', d);
    await undo();
  }

  // ---------------- S12 autosave 草稿：守卫→恢复→保存清稿→丢弃 ----------------
  S('S12 autosave 草稿全链路 + beforeunload 守卫 + 栏宽跨 reload');
  await page.keyboard.press('Control+KeyS');
  await until(() => st(() => !window.__tedStore.getState().dirty && !localStorage.getItem('fate-ted-draft')), 'S12a 先落盘：dirty 清、草稿清');
  const diskBeforeDraft = fs.readFileSync(ISO_DOC, 'utf8');
  await page.click('.ted-title-field input');
  await page.keyboard.press('End');
  await page.keyboard.type('草稿X');
  await until(() => st(() => {
    const d = JSON.parse(localStorage.getItem('fate-ted-draft') || 'null');
    return !!d?.doc && JSON.stringify(d.doc).includes('草稿X') && !!d.baseHash;
  }), 'S12b 编辑 debounce 落草稿（含 baseHash/ts）', 8000);
  let dlg = acceptUnload();
  await page.reload();
  await ready();
  expect(dlg() === 'beforeunload', 'S12c 带脏改动刷新触发 beforeunload 守卫');
  await until(() => st(() => !!document.querySelector('.ted-draftbar')), 'S12d 重载后出草稿恢复条');
  await page.click('.ted-draftbar .ted-btn:has-text("恢复草稿")');
  await until(() => st(() => window.__h.st().chapters.some((c) => c.title.includes('草稿X')) && window.__h.st().dirty), 'S12e 恢复草稿：内容+dirty');
  await page.keyboard.press('Control+KeyS');
  await until(async () => !(await st(() => window.__tedStore.getState().dirty)), 'S12f 草稿落盘');
  expect(fs.readFileSync(ISO_DOC, 'utf8').includes('草稿X') && !(await st(() => localStorage.getItem('fate-ted-draft'))), 'S12g 保存成功 → 磁盘含草稿改动、草稿键清除');
  // 丢弃路径
  await page.click('.ted-title-field input');
  await page.keyboard.press('End');
  await page.keyboard.type('弃稿Y');
  await until(() => st(() => JSON.stringify(JSON.parse(localStorage.getItem('fate-ted-draft') || 'null')?.doc || {}).includes('弃稿Y')), 'S12h 二次编辑再落草稿', 8000);
  dlg = acceptUnload();
  await page.reload();
  await ready();
  await until(() => st(() => !!document.querySelector('.ted-draftbar')), 'S12i 再现恢复条');
  await page.click('.ted-draftbar .ted-btn:has-text("丢弃")');
  await until(() => st(() => !localStorage.getItem('fate-ted-draft') && !document.querySelector('.ted-draftbar')), 'S12j 丢弃：草稿键删、恢复条收');
  expect(await st(() => !window.__h.st().chapters.some((c) => c.title.includes('弃稿Y')) && !window.__h.st().dirty), 'S12k 丢弃后 = 磁盘态（弃稿Y 不存在）');
  expect((await st(() => getComputedStyle(document.querySelector('.ted-tree')).width)) === '310px', 'S12l 栏宽跨 reload 生效（310px）');
  // 现场复原：把 草稿X 从标题去掉，回到 S12 前的磁盘态
  await st(() => {
    const s = window.__h.st();
    const hit = s.chapters.find((c) => c.title.includes('草稿X'));
    if (hit) s.setTitle(hit.uid, hit.title.replace('草稿X', ''));
  });
  await page.keyboard.press('Control+KeyS');
  await until(() => fs.readFileSync(ISO_DOC, 'utf8') === diskBeforeDraft, 'S12m 现场复原（磁盘回 S12 起点）');

  // ---------------- S13 多标签 BroadcastChannel 锁 ----------------
  S('S13 多标签锁：后开只读·动作拦截·夺锁·持锁者退场回收');
  const page2 = await ctx.newPage();
  page2.on('pageerror', (e) => pageErrors.push('page2: ' + String(e.message).slice(0, 200)));
  await page2.goto(EDITOR_URL);
  await until(() => page2.evaluate(() => window.__tedStore?.getState().status === 'ready' && window.__tedStore.getState().ro
    && !!document.querySelector('.ted-robar')), 'S13a 后开标签只读 + 横幅（竞选稳态）');
  {
    const before = await page2.evaluate(() => window.__h.counts().ch);
    await page2.evaluate(() => window.__h.st().addTopChapter());
    const after = await page2.evaluate(() => window.__h.counts().ch);
    const saveDisabled = await page2.evaluate(() => document.querySelector('.ted-btn.primary').disabled);
    expect(before === after && saveDisabled, 'S13b 只读标签编辑动作被 RO_BLOCKED 拦截、保存钮灰显');
  }
  await page2.click('.ted-robar .ted-btn:has-text("夺锁编辑")');
  await until(() => page2.evaluate(() => !window.__tedStore.getState().ro), 'S13c 标签2 夺锁成功');
  await until(() => st(() => window.__tedStore.getState().ro && !!document.querySelector('.ted-robar')), 'S13d 原持锁标签1 被挤成只读');
  {
    const t0 = await st(() => window.__h.st().chapters[0].title);
    await st((t) => window.__h.st().setTitle(window.__h.st().chapters[0].uid, t + '不该生效'), t0);
    expect((await st(() => window.__h.st().chapters[0].title)) === t0, 'S13e 只读标签1 的编辑被拦');
  }
  await page.click('.ted-robar .ted-btn:has-text("夺锁编辑")');
  await until(() => st(() => !window.__tedStore.getState().ro), 'S13f 标签1 夺回');
  await until(() => page2.evaluate(() => window.__tedStore.getState().ro), 'S13g 标签2 转只读');
  await page2.click('.ted-robar .ted-btn:has-text("夺锁编辑")'); // 标签2 再持锁，然后直接关掉（不触发 bye → 走看门狗）
  await until(() => page2.evaluate(() => !window.__tedStore.getState().ro), 'S13h 标签2 再持锁');
  await page2.close();
  await until(() => st(() => !window.__tedStore.getState().ro), 'S13i 持锁者退场后原标签 12s 内夺回编辑权', 15000, 300);

  // ---------------- S14 共享渲染器基线：编辑器预览 vs 游戏 RulesPanel 逐字节一致 ----------------
  S('S14 渲染器基线 diff：同一夹具在编辑器预览与游戏面板逐字节一致（归一化剥 data-*）');
  // T① 的抽取前/后基线 diff 已一次性完成（scratchpad rules-baseline*.json）；本套件的可复跑等价物：
  // 双上下文同源断言——TutorialContent 是唯一渲染真源，两边 HTML（剥 data-* 锚点后）必须逐字节相同。
  const norm = (html) => html.replace(/\sdata-[\w-]+="[^"]*"/g, '');
  const preS14 = fs.readFileSync(ISO_DOC);
  fs.writeFileSync(ISO_DOC, JSON.stringify({ chapters: FIXTURE }, null, 2) + '\n');
  await page.goto(EDITOR_URL); // 不 dirty，无守卫弹框
  await ready();
  await st(() => window.__h.st().openAll());
  const edHtml = {};
  for (const [title, marker] of [['夹具甲', 'fs-xl'], ['夹具乙', 'rb-track']]) {
    await st((t) => window.__h.st().select(window.__h.byTitle(t).uid), title);
    await until(() => st(({ t, m }) => {
      const el = document.querySelector('.ted-preview .tut-content');
      return !!el && el.querySelector('.tut-content-title')?.textContent.includes(t) && el.innerHTML.includes(m);
    }, { t: title, m: marker }), `S14a 编辑器预览渲染 ${title}`);
    edHtml[title] = norm(await st(() => document.querySelector('.ted-preview .tut-content').innerHTML));
  }
  await page.goto(`${BASE}/preview.html?phase=LOBBY`);
  await page.waitForSelector('.rules-root .hud-icon-btn', { timeout: 90000 });
  await page.evaluate(async (fx) => {
    const m = await import('/src/text/index.js');
    m.T.rules.chapters.splice(0, m.T.rules.chapters.length, ...fx); // 原地变异：CHAPTERS 引用在模块求值期抓死
  }, FIXTURE);
  await page.click('.rules-root .hud-icon-btn');
  await page.waitForSelector('.rules-overlay .tut-nav', { timeout: 20000 });
  const gameHtml = {};
  for (const title of ['夹具甲', '夹具乙']) {
    await page.locator('.tut-nav-item', { hasText: title }).first().click();
    await until(() => st((t) => document.querySelector('.tut-content-title')?.textContent.includes(t), title), `S14b 游戏面板切到 ${title}`);
    gameHtml[title] = norm(await st(() => document.querySelector('.tut-content').innerHTML));
  }
  for (const title of ['夹具甲', '夹具乙']) {
    expect(edHtml[title] === gameHtml[title], `S14c ${title}：编辑器预览 ≡ 游戏面板（逐字节）`,
      edHtml[title] === gameHtml[title] ? undefined : { ed: edHtml[title].slice(0, 200), game: gameHtml[title].slice(0, 200) });
  }
  fs.writeFileSync(ISO_DOC, preS14); // 复原隔离副本

  // ---------------- 终态截图（CDP）+ 隔离审计 ----------------
  S('终态：CDP 整页截图 + 真文件/真图库隔离审计');
  await page.goto(EDITOR_URL);
  await ready();
  await st(() => { // 选一个有内容的章节让截图有看头
    const s = window.__h.st();
    const walk = (ns) => { for (const n of ns || []) { if (n.body.length >= 3) return n; const r = walk(n.children); if (r) return r; } return null; };
    const hit = walk(s.chapters);
    if (hit) s.select(hit.uid);
  });
  await until(() => st(() => (document.querySelector('.ted-preview .tut-content')?.children.length ?? 0) > 1), '截图前预览渲染完成');
  {
    const cdp2 = await ctx.newCDPSession(page);
    const shot = await cdp2.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
    pass(`整体观感截图 → ${path.relative(CLIENT, SHOT)}`);
  }
  {
    const real = fs.readFileSync(REAL_DOC, 'utf8');
    const leaked = MARKERS.filter((m) => real.includes(m));
    expect(leaked.length === 0, '真 tutorial.json 不含任何测试串（隔离未击穿）', leaked);
    const nowImgs = new Set(fs.existsSync(REAL_IMG) ? fs.readdirSync(REAL_IMG) : []);
    const added = [...nowImgs].filter((f) => !realImgBefore.has(f) && f === pastedName);
    expect(added.length === 0, '真 public/tutorial/ 无本套件上传物', added);
  }
  expect(pageErrors.length === 0, '全程无 pageerror（两标签）', pageErrors);

  console.log(`\nALL PASS —— ${passed} 项断言全绿`);
} catch (err) {
  console.error('\nFAILED:', err.message);
  if (failShot) await failShot();
  console.error('vite 日志尾部：\n' + viteLog.join('').split('\n').slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  killVite();
  await sleep(500);
}
