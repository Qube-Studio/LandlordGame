// 教程编辑器 2.0 文件 IO —— Vite dev 插件（EDITOR_OVERHAUL §1.1）。
// 仅 dev 生效（apply:'serve'，构建期物理不存在）；写盘 API 有三道防线：
//   ① Host 头白名单 localhost（allowedHosts 有 cpolar 公网隧道且隧道源 IP=127.0.0.1，只能靠 Host 辨）；
//   ② PUT 带 baseHash 乐观锁，磁盘被他人改过 → 409（多窗口/legacy 编辑器并存不互吞）；
//   ③ tmp+rename 原子写（游戏页 HMR 不会读到半截 JSON）。
// E2E 隔离：TUTORIAL_DOC_FILE / TUTORIAL_IMG_DIR 环境变量重定向（绝对路径；禁 URL 参数防穿越）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const HOST_OK = /^(localhost|127\.0\.0\.1)(:\d+)?$/;
const DOC_LIMIT = 2 * 1024 * 1024;
const IMG_LIMIT = 20 * 1024 * 1024;
// 文件名消毒：只留最后一段、去可疑字符，防目录穿越（照抄 legacy server.mjs）
const safeName = (name) => path.basename(String(name || '')).replace(/[^\w.\-一-鿿]+/g, '_').replace(/^\.+/, '') || 'image';
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

const readBody = (req, limit) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > limit) { reject(Object.assign(new Error('payload too large'), { code: 413 })); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});
const sendJSON = (res, code, obj) => {
  const s = JSON.stringify(obj);
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(s);
};
// 原子写：同目录 tmp 落盘再 rename 顶替
function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

export default function tutorialApi() {
  return {
    name: 'fate-tutorial-api',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      const DOC = process.env.TUTORIAL_DOC_FILE || path.resolve(root, 'src/text/tutorial.json');
      const IMG_DIR = process.env.TUTORIAL_IMG_DIR || path.resolve(root, 'public/tutorial');

      const readDoc = () => {
        try {
          const raw = fs.readFileSync(DOC, 'utf8');
          const st = fs.statSync(DOC);
          return { raw, data: JSON.parse(raw), hash: sha1(raw), mtime: st.mtimeMs };
        } catch {
          return { raw: null, data: { chapters: [] }, hash: 'absent', mtime: 0 };
        }
      };

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__tutorial-api/')) return next();
        if (!HOST_OK.test(req.headers.host || '')) return sendJSON(res, 403, { error: 'forbidden host' });
        const url = new URL(req.url, 'http://localhost');
        const route = url.pathname.slice('/__tutorial-api'.length);
        try {
          if (req.method === 'GET' && route === '/doc') {
            const { data, hash, mtime } = readDoc();
            data.chapters ??= [];
            return sendJSON(res, 200, { data, hash, mtime, path: path.relative(path.resolve(root, '..'), DOC).replace(/\\/g, '/') });
          }
          if (req.method === 'PUT' && route === '/doc') {
            const body = (await readBody(req, DOC_LIMIT)).toString('utf8');
            let payload;
            try { payload = JSON.parse(body); } catch (e) { return sendJSON(res, 400, { error: 'JSON 解析失败：' + e.message }); }
            const { data, baseHash, force } = payload;
            if (!data || typeof data !== 'object') return sendJSON(res, 400, { error: '缺 data' });
            const cur = readDoc();
            if (!force && baseHash !== cur.hash) return sendJSON(res, 409, { error: '磁盘文件已被他人修改', hash: cur.hash });
            data.chapters ??= [];
            const text = JSON.stringify(data, null, 2) + '\n'; // 落盘格式与 legacy/CLI 逐字节一致
            atomicWrite(DOC, text);
            return sendJSON(res, 200, { ok: true, hash: sha1(text), mtime: fs.statSync(DOC).mtimeMs });
          }
          if (req.method === 'POST' && route === '/upload') {
            const bytes = await readBody(req, IMG_LIMIT);
            if (!bytes.length) return sendJSON(res, 400, { error: '空文件' });
            const name = safeName(url.searchParams.get('name'));
            fs.mkdirSync(IMG_DIR, { recursive: true });
            fs.writeFileSync(path.join(IMG_DIR, name), bytes); // 同名覆盖（与 legacy 一致，可预期）
            return sendJSON(res, 200, { url: `/tutorial/${name}`, name });
          }
          if (req.method === 'GET' && route === '/images') {
            let images = [];
            try {
              images = fs.readdirSync(IMG_DIR)
                .filter((f) => /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(f))
                .map((f) => { const st = fs.statSync(path.join(IMG_DIR, f)); return { name: f, url: `/tutorial/${f}`, size: st.size, mtime: st.mtimeMs }; })
                .sort((a, b) => b.mtime - a.mtime);
            } catch { /* 目录不存在 → 空图库 */ }
            return sendJSON(res, 200, { images });
          }
          sendJSON(res, 404, { error: 'not found' });
        } catch (err) {
          sendJSON(res, err.code === 413 ? 413 : 500, { error: String(err.message || err) });
        }
      });
    },
  };
}
