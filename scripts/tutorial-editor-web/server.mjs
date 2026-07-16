// 教程内容编辑器（可视化）· 本地服务端
// 跑法：npm run tutorial        （或 node scripts/tutorial-editor-web/server.mjs）
//       可选参数：--file <路径> 指向别的 JSON；--port <端口>（默认 4123）；--no-open 不自动开浏览器
//
// 只用 Node 内置模块，零依赖零构建。职责：
//   GET  /                → 编辑器页面 index.html
//   GET  /api/tutorial    → 读取当前 tutorial.json（含所在路径）
//   PUT  /api/tutorial    → 保存（整份 JSON，落盘格式与 CLI 版一致：2 空格缩进 + 结尾换行）
//   POST /api/upload?name → 上传图片（二进制正文）到 client/public/tutorial/，回传 /tutorial/<名>
//   GET  /api/images      → 图库列表（client/public/tutorial/ 下的图片，编辑器「图库…」选择器用）
//   GET  /font.woff2      → 游戏内打包的像素中文字体（Fusion Pixel 12px SC），编辑器与游戏同字
//   GET  /tutorial/<名>   → 回读上传目录里的图片（让预览里的 /tutorial/* 直接可见，无需 Vite）
//
// 数据格式（与 RulesPanel 渲染器 + CLI 版约定一致）：
//   章节 = { id, title, body:[段落...], children:[章节...] }，层级不限深。
//   段落 = 字符串（**…** 金字高亮、"- " 开头缩进列表项；空串 = 排版空行）
//        | { text, size }（字号段，size ∈ s/l/xl）| { img, alt }（图片段）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const argv = process.argv.slice(2);
const argVal = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
const FILE = argVal('--file') ? path.resolve(argVal('--file')) : path.join(ROOT, 'client', 'src', 'text', 'tutorial.json');
const IMG_DIR = path.join(ROOT, 'client', 'public', 'tutorial'); // 图片入库目录（Vite 构建原样拷入，线上 URL = /tutorial/<名>）
const PORT = Number(argVal('--port') || process.env.PORT || 4123);
const AUTO_OPEN = !argv.includes('--no-open');

const FONT_FILE = path.join(ROOT, 'client', 'src', 'assets', 'fonts', 'fusion-pixel-12px-proportional-zh_hans.otf.woff2');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});
const sendJSON = (res, code, obj) => {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
};
// 文件名消毒：只留最后一段、去掉可疑字符，防目录穿越
const safeName = (name) => path.basename(String(name || '')).replace(/[^\w.\-一-鿿]+/g, '_').replace(/^\.+/, '') || 'image';

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = decodeURIComponent(url.pathname);

    // ---- 页面 ----
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(HERE, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' }); // 改了页面刷新即生效，防陈旧缓存
      return res.end(html);
    }

    // ---- 读取 JSON ----
    if (req.method === 'GET' && pathname === '/api/tutorial') {
      let data = { chapters: [] };
      try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* 文件缺失/损坏 → 空树起步 */ }
      data.chapters ??= [];
      return sendJSON(res, 200, { path: path.relative(ROOT, FILE).replace(/\\/g, '/'), data });
    }

    // ---- 保存 JSON ----
    if (req.method === 'PUT' && pathname === '/api/tutorial') {
      const raw = (await readBody(req)).toString('utf8');
      let data;
      try { data = JSON.parse(raw); } catch (e) { return sendJSON(res, 400, { error: `JSON 解析失败：${e.message}` }); }
      data.chapters ??= [];
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8'); // 与 CLI 版落盘格式一致，git diff 最小
      console.log(`已保存 → ${path.relative(ROOT, FILE)}`);
      return sendJSON(res, 200, { ok: true });
    }

    // ---- 上传图片 ----
    if (req.method === 'POST' && pathname === '/api/upload') {
      const bytes = await readBody(req);
      if (!bytes.length) return sendJSON(res, 400, { error: '空文件' });
      const name = safeName(url.searchParams.get('name'));
      fs.mkdirSync(IMG_DIR, { recursive: true });
      fs.writeFileSync(path.join(IMG_DIR, name), bytes); // 同名覆盖（与 CLI 版 bi 一致，可预期）
      console.log(`已入库图片 → client/public/tutorial/${name}`);
      return sendJSON(res, 200, { url: `/tutorial/${name}`, name });
    }

    // ---- 像素字体（与游戏共用 client/src/assets/fonts/ 里的打包文件）----
    if (req.method === 'GET' && pathname === '/font.woff2') {
      if (fs.existsSync(FONT_FILE)) {
        res.writeHead(200, { 'Content-Type': MIME['.woff2'], 'Cache-Control': 'max-age=86400' });
        return fs.createReadStream(FONT_FILE).pipe(res);
      }
      res.writeHead(404); return res.end('font not found'); // 字体缺失不致命：页面栈会退回系统像素字/宋体
    }

    // ---- 图库列表（新→旧排序）----
    if (req.method === 'GET' && pathname === '/api/images') {
      let images = [];
      try {
        images = fs.readdirSync(IMG_DIR)
          .filter((f) => /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(f))
          .map((f) => { const st = fs.statSync(path.join(IMG_DIR, f)); return { name: f, url: `/tutorial/${f}`, size: st.size, mtime: st.mtimeMs }; })
          .sort((a, b) => b.mtime - a.mtime);
      } catch { /* 目录不存在 → 空图库 */ }
      return sendJSON(res, 200, { images });
    }

    // ---- 回读上传目录里的图片（让预览的 /tutorial/* 直接可见）----
    if (req.method === 'GET' && pathname.startsWith('/tutorial/')) {
      const file = path.join(IMG_DIR, safeName(pathname.slice('/tutorial/'.length)));
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { 'Content-Type': mimeOf(file), 'Cache-Control': 'no-cache' });
        return fs.createReadStream(file).pipe(res);
      }
      res.writeHead(404); return res.end('not found');
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJSON(res, 500, { error: err.message });
    else res.end();
  }
});

server.listen(PORT, () => {
  const target = `http://localhost:${PORT}/`;
  console.log('教程内容编辑器（可视化）');
  console.log(`  数据文件：${path.relative(ROOT, FILE).replace(/\\/g, '/')}`);
  console.log(`  图片入库：client/public/tutorial/`);
  console.log(`  打开：    ${target}`);
  console.log('  Ctrl+C 退出。');
  if (AUTO_OPEN) openBrowser(target);
});

// 尽力自动开浏览器；失败不致命（上面已打印 URL）。
function openBrowser(target) {
  try {
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]]
      : process.platform === 'darwin' ? ['open', [target]]
      : ['xdg-open', [target]];
    spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch { /* 忽略：用户可手动打开上面的 URL */ }
}
