import {
  createPathProgress,
  cursorAtProgress,
  drawArtworkBackground,
  drawArtworkLine,
  drawArtworkLineRange,
  penArcAt,
  planArtwork,
  routeFor,
  routeIntervals,
  renderSize,
  type AnimationDirection,
  type AnimationRoute,
  type ArtworkPlan,
  type NormalizedPoint,
  type OneLinePath,
  type PathCursor,
  type PathProgressIndex,
  type RasterImage,
  type RenderSettings,
  type Size,
  usesLineColors,
} from '../../../core';
import { createSurface, freeSurface, lineColorsFor, type Surface } from '../artworkRenderer';

export interface AnimatorSource {
  readonly path: OneLinePath;
  readonly settings: RenderSettings;
  /** Long edge of the frames (same render resolution as the static artwork). */
  readonly longEdge: number;
  readonly image: RasterImage;
  readonly backgroundImage?: CanvasImageSource | null;
  /** Order of drawing (the path itself never changes). Default: forward from the path's start. */
  readonly direction?: AnimationDirection;
  readonly startPoint?: NormalizedPoint | null;
}

export interface FrameResult {
  readonly progress: number;
  /** Position of the pen (for forward playback from the start: the drawn part). */
  readonly cursor: PathCursor;
  readonly visibleLength: number;
  readonly renderMs: number;
}

/**
 * Renders frames of the drawing process from the SAME OneLinePath and the
 * SAME renderer as the static artwork (drawArtworkBackground / -LineRange).
 * Prepared once: render plan, sampled colours, arc-length index.
 *
 * Opaque line (the normal case): frames are drawn DIRECTLY onto the target —
 * background once, then per frame only the new piece of line. No extra
 * surfaces, no per-frame compositing (this matters at 4096 px).
 * Semi-transparent line: the line grows on a persistent layer that is
 * composited over a background surface with the opacity applied once.
 * At progress 1 the whole line is drawn in one go, exactly like the static render.
 *
 * Direction and start point only change the ORDER: the route lists which
 * stretches of the path are drawn by a progress; each stretch is drawn with
 * the same drawArtworkLineRange, so the geometry is always the one path.
 */
export interface ArtworkAnimator {
  readonly size: Size;
  readonly plan: ArtworkPlan;
  readonly index: PathProgressIndex;
  /** Drawing order (direction + start point) over the unchanged path. */
  readonly route: AnimationRoute;
  /** Offscreen surfaces held by this animator (0 for an opaque line). */
  readonly surfaceCount: number;
  /** Draws the frame for `progress` onto `target` (incrementally when moving forward). */
  renderAt(target: CanvasRenderingContext2D, progress: number): FrameResult;
  /** Draws the frame for `progress` from scratch (reproducible regardless of history). */
  renderFresh(target: CanvasRenderingContext2D, progress: number): FrameResult;
  dispose(): void;
}

export function createArtworkAnimator(source: AnimatorSource): ArtworkAnimator {
  const { path, settings } = source;
  const size = renderSize(path.bounds, source.longEdge);
  const lineColors = usesLineColors(settings) ? lineColorsFor(path, source.image, settings) : null;
  const plan = planArtwork({ path, settings, width: size.width, height: size.height, lineColors });
  const index = createPathProgress(path);
  const route = routeFor(index, source.direction ?? 'forward', source.startPoint ?? null);
  const backgroundImage = source.backgroundImage ?? undefined;
  const direct = plan.lineOpacity >= 1;

  // Layers exist only for a semi-transparent line.
  const background: Surface | null = direct ? null : createSurface(size.width, size.height);
  if (background) drawArtworkBackground(plan, background.ctx, backgroundImage);
  const line: Surface | null = direct ? null : createSurface(size.width, size.height);

  /** Progress the target (direct) or the line layer (layered) currently shows. */
  let drawnProgress = -1;
  let drawnTarget: CanvasRenderingContext2D | null = null;

  const cursorAtArc = (arc: number) => cursorAtProgress(index, index.totalLength > 0 ? arc / index.totalLength : 1);
  /** Draws the stretches that become visible between two progress values. */
  const drawBetween = (ctx: CanvasRenderingContext2D, p0: number, p1: number) => {
    for (const { a, b } of routeIntervals(route, p0, p1)) drawArtworkLineRange(plan, path, ctx, a > 0 ? cursorAtArc(a) : null, cursorAtArc(b));
  };

  const result = (progress: number, started: number): FrameResult => ({
    progress,
    cursor: cursorAtArc(penArcAt(route, progress)),
    visibleLength: Math.min(1, Math.max(0, progress)) * index.totalLength,
    renderMs: performance.now() - started,
  });

  const renderDirect = (target: CanvasRenderingContext2D, progress: number, fresh: boolean): FrameResult => {
    const started = performance.now();
    const continues = !fresh && target === drawnTarget && progress >= drawnProgress;
    // Final artwork already on this target (e.g. during the final hold): nothing to draw.
    if (continues && drawnProgress >= 1) return result(progress, started);
    if (progress >= 1) {
      // Final frame: the same operations as the static artwork (background, then the whole line).
      drawArtworkBackground(plan, target, backgroundImage);
      drawArtworkLine(plan, path, target);
    } else if (continues) {
      drawBetween(target, drawnProgress, progress);
    } else {
      drawArtworkBackground(plan, target, backgroundImage);
      drawBetween(target, 0, progress);
    }
    drawnProgress = progress;
    drawnTarget = target;
    return result(progress, started);
  };

  const composite = (target: CanvasRenderingContext2D) => {
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = 1;
    target.clearRect(0, 0, size.width, size.height);
    target.drawImage(background!.canvas as CanvasImageSource, 0, 0);
    target.globalAlpha = plan.lineOpacity;
    target.drawImage(line!.canvas as CanvasImageSource, 0, 0);
    target.globalAlpha = 1;
  };

  const renderLayered = (target: CanvasRenderingContext2D, progress: number, fresh: boolean): FrameResult => {
    const started = performance.now();
    const layer = line!.ctx;
    if (!(progress >= 1 && !fresh && drawnProgress >= 1)) {
      const restart = fresh || progress < drawnProgress || progress >= 1;
      if (restart) {
        layer.setTransform(1, 0, 0, 1, 0, 0);
        layer.clearRect(0, 0, size.width, size.height);
      }
      // At 1 the whole line in one go, like the static render; otherwise only the new stretches.
      if (progress >= 1) drawArtworkLine(plan, path, layer);
      else drawBetween(layer as unknown as CanvasRenderingContext2D, restart ? 0 : drawnProgress, progress);
      drawnProgress = progress;
    }
    composite(target);
    return result(progress, started);
  };

  const render = direct ? renderDirect : renderLayered;
  return {
    size,
    plan,
    index,
    route,
    surfaceCount: direct ? 0 : 2,
    renderAt: (target, progress) => render(target, progress, false),
    renderFresh: (target, progress) => render(target, progress, true),
    dispose() {
      if (background) freeSurface(background);
      if (line) freeSurface(line);
    },
  };
}
