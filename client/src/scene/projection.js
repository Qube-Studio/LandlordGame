// 3D→屏幕坐标桥：场景内的 <Projector> 写入投影函数，2D 飞牌层据此把钞票精确飞到桌面位置。
let _project = null;

export function setProjector(fn) { _project = fn; }

// 返回 {x, y}（屏幕像素），未就绪时返回 null
export function projectPoint(x, y, z) {
  return _project ? _project(x, y, z) : null;
}
