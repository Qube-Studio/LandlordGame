// 钱牌分解/拆分（纯表现层逻辑：服务端只认整数金额，钱牌只是 UI 形态）。
// 面额从大到小：10、5、2、1；长按拆分规则见 SPLITS。

export const DENOMS = [10, 5, 2, 1];

export const SPLITS = {
  10: [5, 5],
  5: [2, 2, 1],
  2: [1, 1],
};

let seq = 0;
export function makeNote(value) {
  seq += 1;
  return { id: `note-${seq}`, value };
}

// 贪心分解金额为钱牌数组（从大到小排列）
export function decompose(amount) {
  const notes = [];
  let rest = Math.max(0, Math.floor(amount));
  for (const d of DENOMS) {
    while (rest >= d) {
      notes.push(makeNote(d));
      rest -= d;
    }
  }
  return notes;
}

// 拆分一张钱牌，返回新数组（保持面额从大到小排序）
export function splitNote(notes, id) {
  const target = notes.find(n => n.id === id);
  if (!target || !SPLITS[target.value]) return notes;
  const pieces = SPLITS[target.value].map(makeNote);
  return [...notes.filter(n => n.id !== id), ...pieces].sort((a, b) => b.value - a.value);
}

export function sumNotes(notes, ids = null) {
  return notes.reduce((s, n) => s + ((ids === null || ids.has(n.id)) ? n.value : 0), 0);
}

// 投保槽内保单牌的堆叠样式（堆叠式，不是展开式）：后入的压在上面、整叠居中，
// 每张水平错位+微旋，读作「一叠塞进框里的钞票」。竖向居中不偏移——钱框与纸币等高，
// 偏移会溢出。step/rot 是可调的视觉参数。
export function insStackStyle(i, n) {
  const step = 4;                          // 每张水平错位像素
  const off = (i - (n - 1) / 2) * step;    // 居中堆叠的水平偏移
  const rot = (i % 2 ? 1 : -1) * 2;        // 交替微转
  return {
    transform: `translate(calc(-50% + ${off}px), -50%) rotate(${rot}deg)`,
    zIndex: i + 1,
  };
}
