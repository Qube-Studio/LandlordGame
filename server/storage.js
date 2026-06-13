// JSON 文件持久化（见 docs/GAME_SPEC.md §5）。数据都存服务端 server/data/（已 gitignore）。
// 接口刻意保持极简（loadJson/saveJson/saveGameRecord），将来换数据库只改本文件。

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const RECORDS_DIR = path.join(DATA_DIR, 'records');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadJson(name, fallback) {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, name), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveJson(name, data) {
  ensureDir(DATA_DIR);
  const file = path.join(DATA_DIR, name);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// 整局对局记录落盘：data/records/<时间戳>-<房间号>.json
export function saveGameRecord(record) {
  ensureDir(RECORDS_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(RECORDS_DIR, `${stamp}-${record.roomId}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2), 'utf8');
  return file;
}
