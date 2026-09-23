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
 * Prepared once: render plan, sampled colours, arc-length index, background.
 * Per frame: progress → cursor (binary search) → draw only the new piece of
 * line onto a persistent line layer → composite onto the target.
 * At progress 1 the line is drawn in one go, exactly like the static render.
 */
export interface ArtworkAnimator {
  readonly size: Size;
  readonly plan: ArtworkPlan;
  readonly index: PathProgressIndex;
  /** Draws the frame for `progress` onto `target` (incrementally when moving forward). */
  renderAt(target: CanvasRenderingContext2D, progress: number): FrameResult;
  /** Draws the frame for `progress` from scratch (reproducible regardless of history; for export). */
  renderFresh(target: CanvasRenderingContext2D, progress: number): FrameResult;
  dispose(): void;
}

export function createArtworkAnimator(source: AnimatorSource): ArtworkAnimator {
  const { path, settings } = source;
  const size = renderSize(path.bounds, source.longEdge);
  const lineColors = settings.colorMode === 'sampled-color' ? lineColorsFor(path, source.image, settings) : null;
  const plan = planArtwork({ path, settings, width: size.width, height: size.height, lineColors });
  const index = createPathProgress(path);

  const background: Surface = createSurface(size.width, size.height);
  drawArtworkBackground(plan, background.ctx, source.backgroundImage ?? undefined);
  const line: Surface = createSurface(size.width, size.height);
  let drawn: PathCursor | null = null;
  let drawnProgress = -1;

  const clearLine = () => {
    line.ctx.setTransform(1, 0, 0, 1, 0, 0);
    line.ctx.clearRect(0, 0, size.width, size.height);
    drawn = null;
    drawnProgress = -1;
  };

  const composite = (target: CanvasRenderingContext2D) => {
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = 1;
    target.clearRect(0, 0, size.width, size.height);
    target.drawImage(background.canvas as CanvasImageSource, 0, 0);
    target.globalAlpha = plan.lineOpacity;
    target.drawImage(line.canvas as CanvasImageSource, 0, 0);
    target.globalAlpha = 1;
  };

  const drawFinalDirect = (target: CanvasRenderingContext2D) => {
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = 1;
    target.clearRect(0, 0, size.width, size.height);
    target.drawImage(background.canvas as CanvasImageSource, 0, 0);
    drawArtworkLine(plan, path, target);
    target.setTransform(1, 0, 0, 1, 0, 0);
  };

  const render = (target: CanvasRenderingContext2D, progress: number, fresh: boolean): FrameResult => {
    const started = performance.now();
    const cursor = cursorAtProgress(index, progress);
    if (progress >= 1) {
      // Final frame: the complete line in one go, composed exactly like the static artwork
      // (opaque line straight onto the background, otherwise via the line layer).
      clearLine();
      if (plan.lineOpacity >= 1) {
        drawFinalDirect(target);
        return { progress, cursor, visibleLength: visibleLength(index, cursor), renderMs: performance.now() - started };
      }
      drawArtworkLine(plan, path, line.ctx);
    } else {
      if (fresh || progress < drawnProgress) clearLine();
      drawArtworkLineRange(plan, path, line.ctx, drawn, cursor);
    }
    drawn = cursor;
    drawnProgress = progress;
    composite(target);
    return { progress, cursor, visibleLength: visibleLength(index, cursor), renderMs: performance.now() - started };
  };

  return {
    size,
    plan,
    index,
    renderAt: (target, progress) => render(target, progress, false),
    renderFresh: (target, progress) => render(target, progress, true),
    dispose() {
      freeSurface(background);
      freeSurface(line);
    },
  };
}
