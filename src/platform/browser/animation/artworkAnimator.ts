import {
  createPathProgress,
  cursorAtProgress,
  drawArtworkBackground,
  drawArtworkLine,
  drawArtworkLineRange,
  planArtwork,
  renderSize,
  visibleLength,
  type ArtworkPlan,
  type OneLinePath,
  type PathCursor,
  type PathProgressIndex,
  type RasterImage,
  type RenderSettings,
  type Size,
} from '../../../core';
import { createSurface, freeSurface, lineColorsFor, type Surface } from '../artworkRenderer';

export interface AnimatorSource {
  readonly path: OneLinePath;
  readonly settings: RenderSettings;
  /** Long edge of the frames (same render resolution as the static artwork). */
  readonly longEdge: number;
  readonly image: RasterImage;
  readonly backgroundImage?: CanvasImageSource | null;
}

export interface FrameResult {
  readonly progress: number;
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
 */
export interface ArtworkAnimator {
  readonly size: Size;
  readonly plan: ArtworkPlan;
  readonly index: PathProgressIndex;
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
  const lineColors = settings.colorMode === 'sampled-color' ? lineColorsFor(path, source.image, settings) : null;
  const plan = planArtwork({ path, settings, width: size.width, height: size.height, lineColors });
  const index = createPathProgress(path);
  const backgroundImage = source.backgroundImage ?? undefined;
  const direct = plan.lineOpacity >= 1;

  // Layers exist only for a semi-transparent line.
  const background: Surface | null = direct ? null : createSurface(size.width, size.height);
  if (background) drawArtworkBackground(plan, background.ctx, backgroundImage);
  const line: Surface | null = direct ? null : createSurface(size.width, size.height);

  /** What the target (direct) or the line layer (layered) currently shows. */
  let drawn: PathCursor | null = null;
  let drawnProgress = -1;
  let drawnTarget: CanvasRenderingContext2D | null = null;

  const result = (progress: number, cursor: PathCursor, started: number): FrameResult => ({
    progress,
    cursor,
    visibleLength: visibleLength(index, cursor),
    renderMs: performance.now() - started,
  });

  const renderDirect = (target: CanvasRenderingContext2D, progress: number, fresh: boolean): FrameResult => {
    const started = performance.now();
    const cursor = cursorAtProgress(index, progress);
    const continues = !fresh && target === drawnTarget && progress >= drawnProgress;
    // Final artwork already on this target (e.g. during the final hold): nothing to draw.
    if (continues && drawnProgress >= 1) return result(progress, cursor, started);
    if (progress >= 1) {
      // Final frame: the same operations as the static artwork (background, then the whole line).
      drawArtworkBackground(plan, target, backgroundImage);
      drawArtworkLine(plan, path, target);
    } else {
      if (!continues) {
        drawArtworkBackground(plan, target, backgroundImage);
        drawn = null;
      }
      drawArtworkLineRange(plan, path, target, drawn, cursor);
    }
    drawn = cursor;
    drawnProgress = progress;
    drawnTarget = target;
    return result(progress, cursor, started);
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
    const cursor = cursorAtProgress(index, progress);
    const layer = line!.ctx;
    if (!(progress >= 1 && !fresh && drawnProgress >= 1)) {
      if (fresh || progress < drawnProgress || progress >= 1) {
        layer.setTransform(1, 0, 0, 1, 0, 0);
        layer.clearRect(0, 0, size.width, size.height);
        drawn = null;
      }
      // At 1 the whole line in one go, like the static render; otherwise only the new piece.
      if (progress >= 1) drawArtworkLine(plan, path, layer);
      else drawArtworkLineRange(plan, path, layer, drawn, cursor);
      drawn = cursor;
      drawnProgress = progress;
    }
    composite(target);
    return result(progress, cursor, started);
  };

  const render = direct ? renderDirect : renderLayered;
  return {
    size,
    plan,
    index,
    surfaceCount: direct ? 0 : 2,
    renderAt: (target, progress) => render(target, progress, false),
    renderFresh: (target, progress) => render(target, progress, true),
    dispose() {
      if (background) freeSurface(background);
      if (line) freeSurface(line);
    },
  };
}
