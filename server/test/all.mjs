// 跑齐 server/test/ 下所有 *.test.mjs（自动发现，新增测试文件无需登记）。
// 跑法：npm test（仓库根）或 node server/test/all.mjs
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter(f => f.endsWith('.test.mjs')).sort();

const failed = [];
for (const f of files) {
  console.log(`\n── ${f} ${'─'.repeat(Math.max(0, 56 - f.length))}`);
  const r = spawnSync(process.execPath, [path.join(here, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(f);
}

console.log(`\n${'═'.repeat(60)}`);
if (failed.length) {
  console.error(`失败 ${failed.length}/${files.length} 套：${failed.join('、')}`);
  process.exit(1);
}
console.log(`全部 ${files.length} 套测试通过 ✅`);
