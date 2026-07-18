// 指针 ↔ 3D 画布坐标（舞台缩放安全）。
// 一律以画布自身 getBoundingClientRect（视觉 CSS px，与 e.clientX/Y 同空间）为基准，而非
// window——桌面 app-stage 缩放/留黑边时 window ≠ 画布可视区；触屏无舞台时画布铺满窗口，同样正确。
// 供 HandLayer 下注拖拽、PayoutLayer 协商拖拽等**触屏与桌面共用**的射线交互使用。

// 指针事件 → 画布内 NDC（-1..1）。out 复用避免每帧分配。
export function pointerNDC(canvas, e, out) {
  const r = canvas.getBoundingClientRect();
  out.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  out.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  return out;
}

// 指针 client Y → 画布内竖直比例（0=顶，1=底）。手牌带阈值判定用。
export function clientYFrac(canvas, clientY) {
  const r = canvas.getBoundingClientRect();
  return (clientY - r.top) / r.height;
}

// 世界点投影后的 NDC.x → 视觉 client X（与 e.clientX 同空间，供捋牌命中比较）。
export function ndcToClientX(canvas, ndcX) {
  const r = canvas.getBoundingClientRect();
  return r.left + (ndcX * 0.5 + 0.5) * r.width;
}
