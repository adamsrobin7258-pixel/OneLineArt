import type { OneLinePath, Size } from '../models';
import type { LineColors } from './colorSampling';
import { toHexColor } from './colorSpace';
import { fullCursor, type PathCursor } from './pathCursor';
import { REFERENCE_RENDER_EDGE, RENDER_LIMITS, RENDERER_VERSION, RenderError, type RenderSettings } from './renderSettings';
import type { PathSink } from './types';

/**
 * The subset of a 2D canvas context the renderer uses. A browser
 * CanvasRenderingContext2D / OffscreenCanvasRenderingContext2D satisfies it
 * structurally, so the core stays free of DOM types.
 */
export interface RenderContext2D extends PathSink {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  globalAlpha: number;
  imageSmoothingEnabled: boolean;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  beginPath(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: never, dx: number, dy: number, dw: number, dh: number): void;
}

/** Colour quantization for stroke runs (per channel). Invisible after smoothing, keeps draw calls bounded. */
export const COLOR_RUN_QUANTUM = 4;

/** Everything needed to draw one artwork, resolved and validated (pure data). */
export interface ArtworkPlan {
  readonly width: number;
  readonly height: number;
  /** Path px → render px. */
  readonly scaleX: number;
  readonly scaleY: number;
  readonly lineWidthPx: number;
  readonly lineOpacity: number;
  readonly background: { readonly kind: 'fill'; readonly color: string } | { readonly kind: 'image' } | { readonly kind: 'transparent' };
  readonly stroke:
    | { readonly kind: 'solid'; readonly color: string }
    /** Run r covers vertices [starts[r], starts[r+1]] — consecutive runs SHARE their boundary vertex. */
    | { readonly kind: 'runs'; readonly starts: Int32Array; readonly colors: readonly string[] };
  readonly settings: RenderSettings;
}

export interface RenderMetrics {
  readonly rendererVersion: string;
  readonly renderWidth: number;
  readonly renderHeight: number;
  readonly renderColorMode: RenderSettings['colorMode'];
  readonly renderBackgroundMode: RenderSettings['background'];
  /** Line width at the reference edge and as actually drawn. */
  readonly lineWidth: number;
  readonly lineWidthPx: number;
  readonly lineOpacity: number;
  readonly pathPoints: number;
  readonly pathLength: number;
  readonly colorSampling: boolean;
  readonly sampleCount: number;
  readonly colorSmoothingWindowPx: number;
  /** Stroke calls used to draw the ONE line (1 in monochrome). */
  readonly strokeRuns: number;
}

/** Render size for a target long edge, keeping the path's aspect ratio exactly (up- or downscaling). */
export function renderSize(bounds: Size, longEdge: number): Size {
  const edge = Math.min(RENDER_LIMITS.renderEdge.max, Math.max(RENDER_LIMITS.renderEdge.min, Math.round(longEdge)));
  const scale = edge / Math.max(bounds.width, bounds.height);
  return { width: Math.max(1, Math.round(bounds.width * scale)), height: Math.max(1, Math.round(bounds.height * scale)) };
}

export interface ArtworkPlanInput {
  readonly path: OneLinePath;
  readonly settings: RenderSettings;
  readonly width: number;
  readonly height: number;
  /** Required for 'sampled-color'. */
  readonly lineColors?: LineColors | null;
}

function checkPath(path: OneLinePath): void {
  const c = path.coords;
  if (!(c instanceof Float32Array) || c.length < 4 || c.length % 2 !== 0) throw new RenderError('invalid-input', 'A path with at least two points is required');
  for (let i = 0; i < c.length; i++) if (!Number.isFinite(c[i])) throw new RenderError('invalid-input', `Non-finite coordinate at ${i >> 1}`);
  if (!(path.bounds.width > 0 && path.bounds.height > 0)) throw new RenderError('invalid-input', 'Path bounds must be positive');
}

/**
 * Resolves settings + target size into a drawing plan. Validates that the
 * target keeps the path's aspect ratio (no distortion, no crop) and that
 * sampled colours belong to this very path.
 */
export function planArtwork({ path, settings, width, height, lineColors }: ArtworkPlanInput): ArtworkPlan {
  checkPath(path);
  const edge = RENDER_LIMITS.renderEdge;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < edge.min || height < edge.min || width > edge.max || height > edge.max) {
    throw new RenderError('invalid-input', `Render size ${width}×${height} outside 1…${edge.max} px`);
  }
  const ratio = path.bounds.width / path.bounds.height;
  // Allow only the rounding error of integer target sizes.
  if (Math.abs(width / height - ratio) > ratio * (1 / Math.min(width, height)) + 1e-9) {
    throw new RenderError('invalid-input', `Render size ${width}×${height} would distort the ${path.bounds.width}×${path.bounds.height} artwork`);
  }

  const n = path.coords.length >> 1;
  let stroke: ArtworkPlan['stroke'];
  if (settings.colorMode === 'sampled-color') {
    if (!lineColors || lineColors.vertexCount !== n) throw new RenderError('invalid-input', 'Sampled colours missing or made for another path');
    const starts: number[] = [];
    const colors: string[] = [];
    let previous = '';
    for (let i = 0; i < n - 1; i++) {
      const q = (v: number) => Math.min(255, Math.round(v / COLOR_RUN_QUANTUM) * COLOR_RUN_QUANTUM);
      const hex = toHexColor([q(lineColors.rgb[i * 3]!), q(lineColors.rgb[i * 3 + 1]!), q(lineColors.rgb[i * 3 + 2]!)]);
      if (hex !== previous) {
        starts.push(i);
        colors.push(hex);
        previous = hex;
      }
    }
    stroke = { kind: 'runs', starts: Int32Array.from(starts), colors };
  } else {
    stroke = { kind: 'solid', color: settings.lineColor };
  }

  const background: ArtworkPlan['background'] =
    settings.background === 'original'
      ? { kind: 'image' }
      : settings.background === 'transparent'
        ? { kind: 'transparent' }
        : { kind: 'fill', color: settings.background === 'black' ? '#000000' : settings.background === 'custom' ? settings.backgroundColor : '#ffffff' };

  return {
    width,
    height,
    scaleX: width / path.bounds.width,
    scaleY: height / path.bounds.height,
    lineWidthPx: settings.lineWidth * (Math.max(width, height) / REFERENCE_RENDER_EDGE),
    lineOpacity: settings.lineOpacity,
    background,
    stroke,
    settings,
  };
}

/** Paints the background. 'image' draws the given source (e.g. the photo) scaled to the artwork. */
export function drawArtworkBackground(plan: ArtworkPlan, ctx: RenderContext2D, backgroundImage?: unknown): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, plan.width, plan.height);
  if (plan.background.kind === 'fill') {
    ctx.fillStyle = plan.background.color;
    ctx.fillRect(0, 0, plan.width, plan.height);
  } else if (plan.background.kind === 'image') {
    if (backgroundImage === undefined || backgroundImage === null) throw new RenderError('invalid-input', "Background 'original' needs the image");
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, plan.width, plan.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(backgroundImage as never, 0, 0, plan.width, plan.height);
  }
}

/**
 * Draws THE line at full opacity (opacity is applied once by the caller, see
 * `renderArtwork` in the platform layer) — optionally only up to `cursor`.
 * The static artwork is the range from the start to the end of the path.
 */
export function drawArtworkLine(plan: ArtworkPlan, path: OneLinePath, ctx: RenderContext2D, cursor: PathCursor = fullCursor(path)): void {
  drawArtworkLineRange(plan, path, ctx, null, cursor);
}

/** Index of the colour run containing segment k (binary search over run starts). */
function runOf(starts: Int32Array, k: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= k) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * THE line-drawing function for both the static artwork and the animation:
 * draws the part of the path between two cursors — continuing exactly where
 * `from` ended (null = the start) up to `to`. Drawing 0→a then a→b yields the
 * same geometry as 0→b, so an animation only adds the new piece per frame.
 *
 * Segment k connects point k and k+1. A cursor {index: m, tip} has drawn the
 * segments 0…m−2 completely and segment m−1 up to `tip` (if any).
 *
 * Monochrome: one stroke per call. Sampled colour: canvas cannot vary the
 * colour within one stroke, so the SAME point sequence is stroked in
 * consecutive colour runs; each run starts at the previous run's last point.
 * No point is added, moved or dropped — the geometry is the one OneLinePath.
 */
export function drawArtworkLineRange(plan: ArtworkPlan, path: OneLinePath, ctx: RenderContext2D, from: PathCursor | null, to: PathCursor): void {
  const c = path.coords;
  const n = c.length >> 1;
  const fromIndex = from ? Math.max(1, Math.min(n, from.index)) : 1;
  const fromTip = from?.tip ?? null;
  const toIndex = Math.max(1, Math.min(n, to.index));
  const toTip = to.tip;
  // Nothing new to draw?
  if (toIndex < fromIndex || (toIndex === fromIndex && (!toTip || (fromTip && fromTip.x === toTip.x && fromTip.y === toTip.y)))) return;

  const { scaleX: sx, scaleY: sy } = plan;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.lineWidth = plan.lineWidthPx;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const runs = plan.stroke.kind === 'runs' ? plan.stroke : null;
  let run = runs ? runOf(runs.starts, fromIndex - 1) : 0;
  ctx.strokeStyle = runs ? runs.colors[run]! : (plan.stroke as { color: string }).color;
  let lastX = fromTip ? fromTip.x : c[(fromIndex - 1) * 2]!;
  let lastY = fromTip ? fromTip.y : c[(fromIndex - 1) * 2 + 1]!;
  ctx.beginPath();
  ctx.moveTo(lastX * sx, lastY * sy);

  const piece = (segment: number, x: number, y: number) => {
    if (runs && run + 1 < runs.starts.length && runs.starts[run + 1]! <= segment) {
      // Colour changes: finish this run and continue at the very same point.
      ctx.stroke();
      run = runOf(runs.starts, segment);
      ctx.strokeStyle = runs.colors[run]!;
      ctx.beginPath();
      ctx.moveTo(lastX * sx, lastY * sy);
    }
    ctx.lineTo(x * sx, y * sy);
    lastX = x;
    lastY = y;
  };

  for (let k = fromIndex - 1; k <= toIndex - 2; k++) piece(k, c[(k + 1) * 2]!, c[(k + 1) * 2 + 1]!);
  if (toTip) piece(toIndex - 1, toTip.x, toTip.y);
  ctx.stroke();
}

/** Reproducible description of a rendering (runtime is added by the caller). */
export function describeArtwork(plan: ArtworkPlan, path: OneLinePath, lineColors?: LineColors | null): RenderMetrics {
  const c = path.coords;
  let length = 0;
  for (let i = 2; i < c.length; i += 2) length += Math.hypot(c[i]! - c[i - 2]!, c[i + 1]! - c[i - 1]!);
  const sampled = plan.stroke.kind === 'runs';
  return {
    rendererVersion: RENDERER_VERSION,
    renderWidth: plan.width,
    renderHeight: plan.height,
    renderColorMode: plan.settings.colorMode,
    renderBackgroundMode: plan.settings.background,
    lineWidth: plan.settings.lineWidth,
    lineWidthPx: plan.lineWidthPx,
    lineOpacity: plan.lineOpacity,
    pathPoints: c.length >> 1,
    pathLength: length,
    colorSampling: sampled,
    sampleCount: sampled && lineColors ? lineColors.stations : 0,
    colorSmoothingWindowPx: sampled && lineColors ? lineColors.smoothingPx : 0,
    strokeRuns: plan.stroke.kind === 'runs' ? plan.stroke.starts.length : 1,
  };
}

