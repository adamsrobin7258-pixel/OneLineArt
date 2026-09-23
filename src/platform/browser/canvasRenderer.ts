import { fullCursor, tracePath, type OneLinePath, type PathCursor, type RenderStyle } from '../../core';

/** Browser adapter: draws a (partial) path onto a <canvas>, sized for the device pixel ratio. */
export function drawPathToCanvas(
  canvas: HTMLCanvasElement,
  path: OneLinePath,
  style: RenderStyle,
  cursor: PathCursor = fullCursor(path),
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || path.bounds.width;
  const scale = (cssWidth * dpr) / path.bounds.width;
  canvas.width = Math.round(path.bounds.width * scale);
  canvas.height = Math.round(path.bounds.height * scale);

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  if (style.backgroundColor) {
    ctx.fillStyle = style.backgroundColor;
    ctx.fillRect(0, 0, path.bounds.width, path.bounds.height);
  } else {
    ctx.clearRect(0, 0, path.bounds.width, path.bounds.height);
  }
  ctx.strokeStyle = style.strokeColor;
  ctx.lineWidth = style.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  tracePath(path, ctx, cursor);
  ctx.stroke();
}
