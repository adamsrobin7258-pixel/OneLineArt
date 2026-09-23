import type { AnimationSettings, OneLinePath } from '../models';
import type { PathCursor } from '../rendering';
import { applyEasing } from './animationSettings';
import { createPathProgress, cursorAtProgress as cursorAtArcProgress, normalizeProgress } from './pathProgress';

/**
 * Maps time to a position on the REAL computed path. The creation video is
 * nothing but a sequence of cursors over the same point list as the final image.
 */
export interface AnimationTimeline {
  readonly frameCount: number;
  cursorAtProgress(progress: number): PathCursor;
  cursorAtFrame(frame: number): PathCursor;
}

export function createTimeline(path: OneLinePath, settings: AnimationSettings): AnimationTimeline {
  const index = createPathProgress(path);
  const n = index.pointCount;
  const frameCount = Math.max(1, Math.round((settings.durationMs / 1000) * settings.fps));
  const easing = settings.easing ?? 'linear';

  const cursorAtProgress = (progress: number): PathCursor => {
    const p = applyEasing(easing, normalizeProgress(progress));
    if (settings.pacing !== 'per-point') return cursorAtArcProgress(index, p);
    // Per-point pacing: equal time per point, regardless of segment length.
    const s = p * (n - 1);
    const i = Math.floor(s);
    const f = s - i;
    if (f === 0 || i >= n - 1) return { index: Math.min(n, i + 1), tip: null };
    const c = path.coords;
    const x0 = c[i * 2]!, y0 = c[i * 2 + 1]!;
    return { index: i + 1, tip: { x: x0 + (c[i * 2 + 2]! - x0) * f, y: y0 + (c[i * 2 + 3]! - y0) * f } };
  };

  return {
    frameCount,
    cursorAtProgress,
    cursorAtFrame: (frame) => cursorAtProgress(frameCount <= 1 ? 1 : frame / (frameCount - 1)),
  };
}
