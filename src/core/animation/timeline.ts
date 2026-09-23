import type { AnimationSettings, OneLinePath } from '../models';
import { cumulativeLengths, pointCount } from '../engine';
import type { PathCursor } from '../rendering';
import { clamp } from '../utils';

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
  const n = pointCount(path);
  const c = path.coords;
  const lengths = cumulativeLengths(path);
  const total = n > 0 ? (lengths[n - 1] as number) : 0;
  const frameCount = Math.max(1, Math.round((settings.durationMs / 1000) * settings.fps));

  /** Position in "segment space": s in [0, n-1]; floor = last full point, fraction = partial segment. */
  const segmentPosition = (progress: number): number => {
    if (n < 2) return 0;
    if (settings.pacing === 'per-point' || total === 0) return progress * (n - 1);
    const target = progress * total;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lengths[mid] as number) <= target) lo = mid;
      else hi = mid - 1;
    }
    if (lo >= n - 1) return n - 1;
    const segLen = (lengths[lo + 1] as number) - (lengths[lo] as number);
    return lo + (segLen > 0 ? (target - (lengths[lo] as number)) / segLen : 0);
  };

  const cursorAtProgress = (progress: number): PathCursor => {
    if (n === 0) return { index: 0, tip: null };
    const s = segmentPosition(clamp(progress, 0, 1));
    const i = Math.floor(s);
    const f = s - i;
    if (f === 0 || i >= n - 1) return { index: i + 1, tip: null };
    const x0 = c[i * 2] as number;
    const y0 = c[i * 2 + 1] as number;
    return {
      index: i + 1,
      tip: { x: x0 + ((c[i * 2 + 2] as number) - x0) * f, y: y0 + ((c[i * 2 + 3] as number) - y0) * f },
    };
  };

  return {
    frameCount,
    cursorAtProgress,
    cursorAtFrame: (frame) => cursorAtProgress(frameCount <= 1 ? 1 : frame / (frameCount - 1)),
  };
}
