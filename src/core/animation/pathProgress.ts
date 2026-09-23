import type { OneLinePath, Point } from '../models';
import type { PathCursor } from '../rendering';
import { AnimationError } from './animationSettings';

/**
 * Prepared once per path: cumulative arc lengths, so every frame finds its
 * position with a binary search (O(log n)) instead of walking the path.
 */
export interface PathProgressIndex {
  readonly path: OneLinePath;
  readonly pointCount: number;
  /** cumulative[i] = arc length from point 0 to point i. */
  readonly cumulative: Float64Array;
  readonly totalLength: number;
}

export function createPathProgress(path: OneLinePath): PathProgressIndex {
  const c = path?.coords;
  if (!(c instanceof Float32Array) || c.length < 4 || c.length % 2 !== 0) throw new AnimationError('invalid-path', 'A path with at least two points is required');
  const n = c.length >> 1;
  const cumulative = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(c[i * 2]! - c[i * 2 - 2]!, c[i * 2 + 1]! - c[i * 2 - 1]!);
    if (!Number.isFinite(d)) throw new AnimationError('invalid-path', `Non-finite coordinate near point ${i}`);
    cumulative[i] = cumulative[i - 1]! + d;
  }
  return { path, pointCount: n, cumulative, totalLength: cumulative[n - 1]! };
}

/** Relative tolerance below which a tip counts as lying on a point (float rounding). */
const SNAP_EPSILON = 1e-9;

/** Progress validation: NaN is rejected; ±Infinity and out-of-range values clamp to [0, 1]. */
export function normalizeProgress(progress: number): number {
  if (typeof progress !== 'number' || Number.isNaN(progress)) throw new AnimationError('invalid-progress', `Progress must be a number (got ${String(progress)})`);
  return progress <= 0 ? 0 : progress >= 1 ? 1 : progress;
}

/** Index of the last point whose arc length is ≤ `length` (binary search). */
function lastPointAtOrBefore(index: PathProgressIndex, length: number): number {
  const { cumulative, pointCount } = index;
  let lo = 0;
  let hi = pointCount - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cumulative[mid]! <= length) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The visible part of the line at `progress` (0…1 of the TOTAL arc length):
 * all complete segments before that length plus the current segment exactly
 * up to it. Never adds a tip that coincides with a vertex (no duplicates).
 *   progress 0 → only the start point (nothing drawn)
 *   progress 1 → the complete path
 */
export function cursorAtProgress(index: PathProgressIndex, progress: number): PathCursor {
  const p = normalizeProgress(progress);
  const { path, pointCount, cumulative, totalLength } = index;
  if (p >= 1) return { index: pointCount, tip: null };
  // A zero-length path (all points equal) is fully visible as soon as drawing starts.
  if (totalLength === 0) return p > 0 ? { index: pointCount, tip: null } : { index: 1, tip: null };
  const target = p * totalLength;
  const i = lastPointAtOrBefore(index, target);
  if (i >= pointCount - 1) return { index: pointCount, tip: null };
  const segment = cumulative[i + 1]! - cumulative[i]!;
  const f = segment > 0 ? (target - cumulative[i]!) / segment : 0;
  // Snap tips that numerically coincide with a point: no near-duplicate points at boundaries.
  const snap = SNAP_EPSILON * Math.max(1, totalLength);
  if (f * segment <= snap) return { index: i + 1, tip: null };
  if ((1 - f) * segment <= snap) return { index: i + 2, tip: null };
  const c = path.coords;
  const x0 = c[i * 2]!, y0 = c[i * 2 + 1]!;
  return { index: i + 1, tip: { x: x0 + (c[i * 2 + 2]! - x0) * f, y: y0 + (c[i * 2 + 3]! - y0) * f } };
}

/** Arc length drawn by a cursor. */
export function visibleLength(index: PathProgressIndex, cursor: PathCursor): number {
  const i = Math.max(0, Math.min(index.pointCount, cursor.index) - 1);
  if (!cursor.tip) return index.cumulative[i]!;
  const c = index.path.coords;
  return index.cumulative[i]! + Math.hypot(cursor.tip.x - c[i * 2]!, cursor.tip.y - c[i * 2 + 1]!);
}

/** The visible part as point list (a copy, for tests/export; rendering uses the cursor directly). */
export function visiblePoints(index: PathProgressIndex, cursor: PathCursor): Point[] {
  const c = index.path.coords;
  const n = Math.min(index.pointCount, cursor.index);
  const points: Point[] = [];
  for (let i = 0; i < n; i++) points.push({ x: c[i * 2]!, y: c[i * 2 + 1]! });
  if (cursor.tip) points.push(cursor.tip);
  return points;
}
