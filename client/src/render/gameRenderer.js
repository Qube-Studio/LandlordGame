// Pure layout/drawing helpers for the full-screen BETTING scene.
// No React/DOM state here — only state -> geometry calculations.

const CARD_WIDTH = 64;
const CARD_HEIGHT = 90;
const FAN_ANGLE_STEP = 6; // degrees between adjacent cards

// Trapezoid representing a tilted (perspective) table surface.
export function computeTableShape(width, height) {
  const topY = height * 0.10;
  const bottomY = height * 0.62;
  const topInset = width * 0.24;
  const bottomInset = width * 0.04;

  return [
    { x: topInset, y: topY },
    { x: width - topInset, y: topY },
    { x: width - bottomInset, y: bottomY },
    { x: bottomInset, y: bottomY },
  ];
}

export function drawTable(ctx, points, width, height) {
  ctx.clearRect(0, 0, width, height);
  if (points.length === 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();

  const gradient = ctx.createLinearGradient(0, points[0].y, 0, points[2].y);
  gradient.addColorStop(0, '#1a1a1a');
  gradient.addColorStop(1, '#050505');
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.stroke();
  ctx.restore();
}

// Fanned hand of cards near the bottom of the screen, slight rotation per card.
export function computeHandLayout({ count, containerWidth, containerHeight }) {
  const centerX = containerWidth / 2;
  const baseY = containerHeight - 130;
  const mid = (count - 1) / 2;
  const spacing = Math.min(70, (containerWidth - 80) / Math.max(count, 1));

  const layout = [];
  for (let i = 0; i < count; i++) {
    const offset = i - mid;
    const rotationDeg = offset * FAN_ANGLE_STEP;
    const x = centerX + offset * spacing - CARD_WIDTH / 2;
    const y = baseY + Math.abs(offset) * Math.abs(offset) * 2.5;
    layout.push({ x, y, rotationDeg, zIndex: 100 - Math.abs(offset) });
  }
  return layout;
}

export function computeBalancePosition() {
  return { right: 32, bottom: 28 };
}

export function computeConfirmButtonPosition(containerWidth, containerHeight) {
  return { x: containerWidth / 2, bottom: containerHeight * 0.28 };
}

export function computeTotalPosition(containerWidth, containerHeight) {
  return { x: containerWidth / 2, y: containerHeight * 0.18 };
}

export const CARD_SIZE = { width: CARD_WIDTH, height: CARD_HEIGHT };
