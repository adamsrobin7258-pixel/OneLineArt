import { luminanceField, resampleField, type RasterImage, type ScalarField, type Size } from '../../core';
import { traceOutline, variableWidthOutline, type VariableWidthLine } from '../../core/experimental/variableWidth';

export function sizeFor(bounds: Size, longEdge: number): Size {
  const scale = longEdge / Math.max(bounds.width, bounds.height);
  return { width: Math.max(1, Math.round(bounds.width * scale)), height: Math.max(1, Math.round(bounds.height * scale)) };
}

/** A shared magnified view: centre (normalized 0…1) and zoom factor (1 = whole picture). */
export interface ViewWindow {
  readonly cx: number;
  readonly cy: number;
  readonly zoom: number;
}

export const FULL_VIEW: ViewWindow = { cx: 0.5, cy: 0.5, zoom: 1 };

/** Sets the canvas transform for a view (centre clamped so the window stays inside the picture). */
export function applyView(ctx: CanvasRenderingContext2D, size: Size, view: ViewWindow = FULL_VIEW): void {
  const z = Math.max(1, view.zoom);
  const half = 1 / (2 * z);
  const cx = Math.min(1 - half, Math.max(half, view.cx)), cy = Math.min(1 - half, Math.max(half, view.cy));
  ctx.setTransform(z, 0, 0, z, size.width / 2 - z * cx * size.width, size.height / 2 - z * cy * size.height);
}

export interface DrawOptions {
  readonly color?: string;
  readonly background?: string;
  /** Draw only the first `upTo` points (0…1 share of the line). */
  readonly progress?: number;
  readonly view?: ViewWindow;
}

/** Fills the variable-width line (as one outline) into a canvas of the given size. */
export function drawLine(ctx: CanvasRenderingContext2D, line: VariableWidthLine, size: Size, o: DrawOptions = {}): void {
  const { width: bw, height: bh } = line.path.bounds;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = o.background ?? '#ffffff';
  ctx.fillRect(0, 0, size.width, size.height);
  const n = line.widths.length;
  const count = Math.max(2, Math.min(n, Math.round((o.progress ?? 1) * n)));
  const outline = variableWidthOutline(line.path.coords.subarray(0, count * 2), line.widths.subarray(0, count), {
    scaleX: size.width / bw,
    scaleY: size.height / bh,
    widthScale: Math.max(size.width, size.height) / Math.max(bw, bh),
  });
  applyView(ctx, size, o.view);
  ctx.beginPath();
  traceOutline(outline, ctx);
  ctx.fillStyle = o.color ?? '#000000';
  ctx.fill('nonzero');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 * The centre line coloured from start (green) to end (red), with start and
 * end markers — makes the ONE route and its direction visible.
 */
export function drawRoute(ctx: CanvasRenderingContext2D, line: VariableWidthLine, size: Size, progress = 1, view: ViewWindow = FULL_VIEW): void {
  const c = line.path.coords;
  const n = c.length >> 1;
  const count = Math.max(2, Math.min(n, Math.round(progress * n)));
  const sx = size.width / line.path.bounds.width, sy = size.height / line.path.bounds.height;
  const chunks = 60;
  const z = Math.max(1, view.zoom);
  applyView(ctx, size, view);
  ctx.lineWidth = Math.max(1, Math.max(size.width, size.height) / 900) / z;
  ctx.lineJoin = 'round';
  for (let k = 0; k < chunks; k++) {
    const from = Math.floor((k * (n - 1)) / chunks), to = Math.min(count - 1, Math.floor(((k + 1) * (n - 1)) / chunks));
    if (from >= to) break;
    ctx.strokeStyle = `hsl(${Math.round(130 - (130 * k) / (chunks - 1))} 80% 42% / 0.85)`;
    ctx.beginPath();
    ctx.moveTo(c[from * 2]! * sx, c[from * 2 + 1]! * sy);
    for (let i = from + 1; i <= to; i++) ctx.lineTo(c[i * 2]! * sx, c[i * 2 + 1]! * sy);
    ctx.stroke();
  }
  const marker = (i: number, fill: string) => {
    ctx.beginPath();
    ctx.arc(c[i * 2]! * sx, c[i * 2 + 1]! * sy, Math.max(5, Math.max(size.width, size.height) / 120) / z, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2 / z;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  };
  marker(0, 'hsl(130 80% 35%)');
  marker(count - 1, count === n ? 'hsl(0 80% 45%)' : 'hsl(40 90% 45%)');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Marks a normalized point (the chosen start) with a ring. */
export function drawStartMarker(ctx: CanvasRenderingContext2D, size: Size, x: number, y: number, view: ViewWindow = FULL_VIEW): void {
  const z = Math.max(1, view.zoom);
  applyView(ctx, size, view);
  const r = Math.max(8, Math.max(size.width, size.height) / 60) / z;
  ctx.beginPath();
  ctx.arc(x * size.width, y * size.height, r, 0, Math.PI * 2);
  ctx.lineWidth = 3 / z;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.lineWidth = 1.5 / z;
  ctx.strokeStyle = 'hsl(130 80% 35%)';
  ctx.stroke();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export function canvasOf(size: Size): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = Object.assign(document.createElement('canvas'), size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas not available');
  return { canvas, ctx };
}

/** Perceptual lightness (L*, 0…1) of a canvas, as the analysis computes it. */
export function lightnessOfCanvas(ctx: CanvasRenderingContext2D, size: Size): ScalarField {
  const data = ctx.getImageData(0, 0, size.width, size.height).data;
  return luminanceField({ ...size, data }, size);
}

/** Lightness of the original at a given size (area average; bilinear when growing). */
export function lightnessOfImage(image: RasterImage, size: Size): ScalarField {
  const grows = size.width > image.width || size.height > image.height;
  return grows ? resampleField(luminanceField(image, image), size) : luminanceField(image, size);
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Spacing colours: within ±1 %, within ±5 %, wider, tighter than the target spacing. */
export const SPACING_COLORS = { ok: 'hsl(140 70% 38%)', near: 'hsl(42 95% 48%)', wide: 'hsl(215 85% 50%)', tight: 'hsl(0 80% 50%)' } as const;

/**
 * Debug overlay: every measured point of the spacing statistics, coloured by
 * its deviation from the spacing parameter (see SPACING_COLORS).
 */
export function drawSpacingMap(ctx: CanvasRenderingContext2D, size: Size, line: VariableWidthLine, samples: Float32Array, view: ViewWindow = FULL_VIEW): void {
  const z = Math.max(1, view.zoom);
  const sx = size.width / line.path.bounds.width, sy = size.height / line.path.bounds.height;
  const target = line.parameters.spacing;
  const r = Math.max(1, (line.spacing * sx) / 5) * Math.min(1, 2 / z) + 0.4;
  applyView(ctx, size, view);
  const groups: Record<keyof typeof SPACING_COLORS, number[]> = { ok: [], near: [], wide: [], tight: [] };
  for (let i = 0; i < samples.length; i += 3) {
    const rel = samples[i + 2]! / target - 1;
    const key = Math.abs(rel) <= 0.01 ? 'ok' : Math.abs(rel) <= 0.05 ? 'near' : rel > 0 ? 'wide' : 'tight';
    groups[key].push(samples[i]! * sx, samples[i + 1]! * sy);
  }
  for (const key of Object.keys(groups) as (keyof typeof SPACING_COLORS)[]) {
    const pts = groups[key];
    ctx.fillStyle = SPACING_COLORS[key];
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      ctx.moveTo(pts[i]! + r, pts[i + 1]!);
      ctx.arc(pts[i]!, pts[i + 1]!, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
