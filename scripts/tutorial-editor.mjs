// 教程章节编辑器（交互式 CLI）：专门维护 client/src/text/tutorial.json 的章节关系与内容。
// 跑法：node scripts/tutorial-editor.mjs   （测试可加 --file <路径> 指向别的 JSON）
//
// 数据格式（与 RulesPanel 渲染器约定一致）：
//   章节 = { id, title, body: [段落...], children: [章节...] }，层级不限深。
//   段落 = 字符串（**…** 渲染金字高亮、"- " 开头渲染缩进列表项）
//        | { img, alt }（图片段落——img 为 URL；图片文件放 client/public/tutorial/ 下）。
//
// 章节用「路径」定位：树里显示的点分序号，如 1 / 1.2 / 2.3.1；root 表示顶层。
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argFile = process.argv.indexOf('--file');
const FILE = argFile >= 0 ? path.resolve(process.argv[argFile + 1]) : path.join(ROOT, 'client', 'src', 'text', 'tutorial.json');
const IMG_DIR = path.join(ROOT, 'client', 'public', 'tutorial'); // 图片入库目录（构建原样拷贝，URL=/tutorial/<文件名>）

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
data.chapters ??= [];
let dirty = false;

// ---------- 树工具 ----------
// 路径 "1.2" → { parent: 容器数组, index, node }；"root" → { parent: null, node: 虚根 }
function locate(p) {
  if (p === 'root') return { parent: null, index: -1, node: { title: '(顶层)', children: data.chapters } };
  const idx = p.split('.').map(s => Number(s) - 1);
  let list = data.chapters, parent = null, node = null, index = -1;
  for (const i of idx) {
    if (!Number.isInteger(i) || i < 0 || i >= list.length) return null;
    parent = list; index = i; node = list[i];
    list = node.children ?? [];
  }
  return node ? { parent, index, node } : null;
}
function* walk(nodes) { for (const n of nodes) { yield n; yield* walk(n.children ?? []); } }
function freshId() {
  const used = new Set([...walk(data.chapters)].map(n => n.id));
  for (let i = 1; ; i++) if (!used.has(`c${i}`)) return `c${i}`;
}
function isDescendant(node, maybeChild) {
  for (const n of walk(node.children ?? [])) if (n === maybeChild) return true;
  return false;
}

// ---------- 显示 ----------
function printTree() {
  const rec = (nodes, prefix, depth) => nodes.forEach((n, i) => {
    const p = prefix ? `${prefix}.${i + 1}` : String(i + 1);
    const parts = `${'  '.repeat(depth)}[${p}] ${n.title}`;
    const meta = `（id=${n.id}，正文 ${n.body?.length ?? 0} 段）`;
    console.log(parts + meta);
    rec(n.children ?? [], p, depth + 1);
  });
  if (!data.chapters.length) console.log('（空树）');
  else rec(data.chapters, '', 0);
}
function paraPreview(item) {
  if (item && typeof item === 'object' && item.img) return `[图片] ${item.img}${item.alt ? `（${item.alt}）` : ''}`;
  const s = String(item);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}
function printBody(node) {
  console.log(`「${node.title}」正文（${node.body?.length ?? 0} 段）：`);
  (node.body ?? []).forEach((item, i) => console.log(`  (${i + 1}) ${paraPreview(item)}`));
}

const HELP = `命令（<路径> = 树中点分序号如 1.2，root = 顶层）：
  ls                          显示章节树
  add <路径> <标题>            在该章节下追加子章节（add root <标题> = 加顶层章节）
  rm <路径>                   删除章节（连同其全部子章节，需确认）
  ren <路径> <新标题>          重命名章节
  mv <路径> <目标路径> [第几个]  把章节移为目标的子章节（缺省排最后；目标可为 root）
  body <路径>                 查看正文段落
  bt <路径> <文字>             追加文字段落（支持 **金字高亮** 与 "- " 缩进行）
  bi <路径> <图片> [说明]       追加图片段落：<图片> 是本地文件则拷入 client/public/tutorial/
                              并引用 /tutorial/<文件名>；以 / 开头则视为现成 URL 直接引用
  be <路径> <段号> <新文字>     改写某段（图片段也可用此改成文字）
  brm <路径> <段号>            删除某段
  bmv <路径> <段号> <新段号>    段落挪位
  save                        保存到 ${path.relative(ROOT, FILE)}
  quit                        退出（有未保存改动会提示）
  help                        显示本帮助`;

// ---------- 命令 ----------
function save() {
  fs.writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  dirty = false;
  console.log(`已保存 → ${FILE}`);
}

function needNode(p) {
  const loc = p ? locate(p) : null;
  if (!loc) { console.log(`路径无效：${p ?? '(缺参数)'}（用 ls 查看序号）`); return null; }
  return loc;
}
const needBodyIndex = (node, s) => {
  const i = Number(s) - 1;
  if (!Number.isInteger(i) || i < 0 || i >= (node.body?.length ?? 0)) { console.log(`段号无效：${s}`); return -1; }
  return i;
};

function cmdAdd(p, title) {
  const loc = needNode(p); if (!loc) return;
  if (!title) { console.log('缺标题'); return; }
  loc.node.children ??= [];
  loc.node.children.push({ id: freshId(), title, body: [], children: [] });
  dirty = true;
  console.log(`已在「${loc.node.title}」下新增「${title}」`);
  printTree();
}
function cmdRen(p, title) {
  const loc = needNode(p); if (!loc) return;
  if (!title) { console.log('缺新标题'); return; }
  console.log(`「${loc.node.title}」→「${title}」`);
  loc.node.title = title;
  dirty = true;
}
function cmdMv(p, targetP, posStr) {
  const loc = needNode(p); if (!loc || !loc.parent) { if (loc && !loc.parent) console.log('不能移动 root'); return; }
  const dst = needNode(targetP); if (!dst) return;
  if (dst.node === loc.node || isDescendant(loc.node, dst.node)) { console.log('不能把章节移到它自己或它的后代下面'); return; }
  loc.parent.splice(loc.index, 1);
  dst.node.children ??= [];
  const pos = posStr ? Math.max(0, Math.min(dst.node.children.length, Number(posStr) - 1)) : dst.node.children.length;
  dst.node.children.splice(pos, 0, loc.node);
  dirty = true;
  printTree();
}
function cmdBt(p, text) {
  const loc = needNode(p); if (!loc) return;
  if (!text) { console.log('缺文字'); return; }
  (loc.node.body ??= []).push(text);
  dirty = true;
  printBody(loc.node);
}
function cmdBi(p, img, alt) {
  const loc = needNode(p); if (!loc) return;
  if (!img) { console.log('缺图片路径'); return; }
  let url = img;
  if (!img.startsWith('/')) {
    // 本地文件 → 拷入 client/public/tutorial/（Vite 原样拷进构建，URL = /tutorial/<文件名>）
    const src = path.resolve(img);
    if (!fs.existsSync(src)) { console.log(`本地文件不存在：${src}（现成 URL 请以 / 开头）`); return; }
    fs.mkdirSync(IMG_DIR, { recursive: true });
    const name = path.basename(src);
    fs.copyFileSync(src, path.join(IMG_DIR, name));
    url = `/tutorial/${name}`;
    console.log(`已拷贝 → client/public/tutorial/${name}`);
  }
  (loc.node.body ??= []).push(alt ? { img: url, alt } : { img: url });
  dirty = true;
  printBody(loc.node);
}
function cmdBe(p, idxStr, text) {
  const loc = needNode(p); if (!loc) return;
  const i = needBodyIndex(loc.node, idxStr); if (i < 0) return;
  if (!text) { console.log('缺新文字'); return; }
  loc.node.body[i] = text;
  dirty = true;
  printBody(loc.node);
}
function cmdBrm(p, idxStr) {
  const loc = needNode(p); if (!loc) return;
  const i = needBodyIndex(loc.node, idxStr); if (i < 0) return;
  loc.node.body.splice(i, 1);
  dirty = true;
  printBody(loc.node);
}
function cmdBmv(p, fromStr, toStr) {
  const loc = needNode(p); if (!loc) return;
  const i = needBodyIndex(loc.node, fromStr); if (i < 0) return;
  const j = needBodyIndex(loc.node, toStr); if (j < 0) return;
  const [item] = loc.node.body.splice(i, 1);
  loc.node.body.splice(j, 0, item);
  dirty = true;
  printBody(loc.node);
}

// ---------- 主循环 ----------
// 顺序 REPL：用 readline 的异步迭代器逐行取输入——每行严格排队消费，
// rm/quit 的确认行走同一队列（rl.question 与常驻 line 监听混用会抢行，管道输入下必炸——已踩坑）。
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();
async function nextLine(promptText) {
  process.stdout.write(promptText);
  const { value, done } = await lines.next();
  return done ? null : value; // null = EOF（Ctrl+D / 管道结束）
}

// 解析：命令 + 若干定长参数 + 「余下整行」作最后一个参数（标题/文字可含空格）
function splitArgs(line, fixed) {
  const parts = line.trim().split(/\s+/);
  const cmd = parts.shift()?.toLowerCase() ?? '';
  const args = parts.splice(0, fixed);
  const rest = parts.join(' ');
  return { cmd, args, rest };
}

console.log(`教程章节编辑器 — ${path.relative(ROOT, FILE)}`);
printTree();
console.log('输入 help 查看命令。');

for (;;) {
  const line = await nextLine('> ');
  if (line == null) { // EOF
    if (dirty) console.log('（输入结束，有未保存改动已丢弃——脚本化编辑请以 save 结尾）');
    break;
  }
  const cmd = line.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  try {
    if (cmd === 'ls') printTree();
    else if (cmd === 'help' || cmd === '?') console.log(HELP);
    else if (cmd === 'add') { const { args, rest } = splitArgs(line, 1); cmdAdd(args[0], rest); }
    else if (cmd === 'rm') {
      const { args } = splitArgs(line, 1);
      const loc = needNode(args[0]);
      if (loc && loc.parent) {
        const kids = [...walk(loc.node.children ?? [])].length;
        const yn = await nextLine(`删除「${loc.node.title}」${kids ? `及其 ${kids} 个子章节` : ''}？(y/N) `);
        if ((yn ?? '').trim().toLowerCase() === 'y') { loc.parent.splice(loc.index, 1); dirty = true; printTree(); }
        else console.log('已取消');
      } else if (loc) console.log('不能删除 root');
    }
    else if (cmd === 'ren') { const { args, rest } = splitArgs(line, 1); cmdRen(args[0], rest); }
    else if (cmd === 'mv') { const { args } = splitArgs(line, 3); cmdMv(args[0], args[1], args[2]); }
    else if (cmd === 'body') { const { args } = splitArgs(line, 1); const loc = needNode(args[0]); if (loc) printBody(loc.node); }
    else if (cmd === 'bt') { const { args, rest } = splitArgs(line, 1); cmdBt(args[0], rest); }
    else if (cmd === 'bi') { const { args, rest } = splitArgs(line, 2); cmdBi(args[0], args[1], rest); }
    else if (cmd === 'be') { const { args, rest } = splitArgs(line, 2); cmdBe(args[0], args[1], rest); }
    else if (cmd === 'brm') { const { args } = splitArgs(line, 2); cmdBrm(args[0], args[1]); }
    else if (cmd === 'bmv') { const { args } = splitArgs(line, 3); cmdBmv(args[0], args[1], args[2]); }
    else if (cmd === 'save') save();
    else if (cmd === 'quit' || cmd === 'exit' || cmd === 'q') {
      if (dirty) {
        const yn = await nextLine('有未保存改动，保存后退出？(Y=保存退出 / n=丢弃退出 / 其他=不退出) ');
        const v = (yn ?? 'n').trim().toLowerCase();
        if (v === '' || v === 'y') { save(); break; }
        if (v === 'n') break;
      } else break;
    }
    else if (cmd !== '') console.log('未知命令，输入 help 查看用法');
  } catch (err) {
    console.log(`出错：${err.message}`);
  }
}
console.log('再见');
rl.close();
