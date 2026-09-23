import type { AnimationDirection, NormalizedPoint, OneLinePath, Point } from '../models';
import { AnimationError } from './animationSettings';
import { normalizeProgress, type PathProgressIndex } from './pathProgress';

/**
 * The ORDER in which the unchanged path is drawn. The path is open but was
 * cut from a closed tour, so its end lies next to its start (typically about
 * one segment apart). A start point therefore rotates the path like a cycle:
 *
 *   path A→B→C→D→E, start at C, forward:  C→D→E, (pen lifts), A→B→C
 *   reverse:                              C→B→A, (pen lifts), E→D→C
 *
 * The connection E→A is never drawn: every segment of the path is drawn
 * exactly once, nothing is added. Pieces are directed arc-length intervals.
 */
export interface RoutePiece {
  /** Arc length where the pen starts this piece. */
  readonly from: number;
  /** Arc length where it ends (smaller than `from` when drawing backwards). */
  readonly to: number;
}

export interface AnimationRoute {
  readonly pieces: readonly RoutePiece[];
  readonly totalLength: number;
}

/** A drawn stretch of the path: arc lengths a < b. */
export interface ArcInterval {
  readonly a: number;
  readonly b: number;
}

/** Route for a direction and an optional start (arc length on the path). */
export function createAnimationRoute(totalLength: number, direction: AnimationDirection = 'forward', startArc: number | null = null): AnimationRoute {
  if (!(totalLength >= 0) || !Number.isFinite(totalLength)) throw new AnimationError('invalid-path', 'Path length must be finite');
  const L = totalLength;
  const s = startArc === null ? (direction === 'forward' ? 0 : L) : Math.min(L, Math.max(0, startArc));
  const raw: RoutePiece[] = direction === 'forward' ? [{ from: s, to: L }, { from: 0, to: s }] : [{ from: s, to: 0 }, { from: L, to: s }];
  const pieces = raw.filter((p) => p.from !== p.to);
  return { pieces: pieces.length ? pieces : [{ from: 0, to: L }], totalLength: L };
}

/** Where the pen is at `progress` (arc length on the path). */
export function penArcAt(route: AnimationRoute, progress: number): number {
  let remaining = normalizeProgress(progress) * route.totalLength;
  for (const piece of route.pieces) {
    const length = Math.abs(piece.to - piece.from);
    if (remaining <= length) return piece.from + Math.sign(piece.to - piece.from) * remaining;
    remaining -= length;
  }
  const last = route.pieces[route.pieces.length - 1]!;
  return last.to;
}

/**
 * The stretches drawn while progress goes from p0 to p1 (p0 ≤ p1), as
 * ascending arc intervals. From 0 to 1 they cover the whole path exactly once.
 */
export function routeIntervals(route: AnimationRoute, p0: number, p1: number): ArcInterval[] {
  const start = normalizeProgress(p0) * route.totalLength;
  const end = normalizeProgress(p1) * route.totalLength;
  const out: ArcInterval[] = [];
  let offset = 0;
  for (const piece of route.pieces) {
    const length = Math.abs(piece.to - piece.from);
    const lo = Math.max(start, offset);
    const hi = Math.min(end, offset + length);
    if (hi > lo) {
      const dir = Math.sign(piece.to - piece.from);
      const x = piece.from + dir * (lo - offset);
      const y = piece.from + dir * (hi - offset);
      out.push({ a: Math.min(x, y), b: Math.max(x, y) });
    }
    offset += length;
  }
  return out;
}

export interface NearestPathPoint {
  /** The closest point ON the path (may lie inside a segment). */
  readonly point: Point;
  /** Arc length of that point. */
  readonly arc: number;
  /** Distance from the requested position (path px). */
  readonly distance: number;
}

/** Geometrically nearest point of the path to `target` (path coordinates); ties keep the earlier one. */
export function nearestPathPoint(index: PathProgressIndex, target: Point): NearestPathPoint {
  const c = index.path.coords;
  const n = index.pointCount;
  let best: NearestPathPoint = { point: { x: c[0]!, y: c[1]! }, arc: 0, distance: Math.hypot(c[0]! - target.x, c[1]! - target.y) };
  for (let i = 0; i < n - 1; i++) {
    const ax = c[i * 2]!, ay = c[i * 2 + 1]!;
    const dx = c[i * 2 + 2]! - ax, dy = c[i * 2 + 3]! - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((target.x - ax) * dx + (target.y - ay) * dy) / len2)) : 0;
    const px = ax + dx * t, py = ay + dy * t;
    const d = Math.hypot(px - target.x, py - target.y);
    if (d < best.distance) best = { point: { x: px, y: py }, arc: index.cumulative[i]! + Math.sqrt(len2) * t, distance: d };
  }
  return best;
}

/** A normalized image point (edited image, 0..1) in path coordinates — the path spans the edited working image. */
export function toPathPoint(path: OneLinePath, point: NormalizedPoint): Point {
  return { x: point.x * path.bounds.width, y: point.y * path.bounds.height };
}

/** The route of a path for playback settings (start point snapped to the nearest path point). */
export function routeFor(index: PathProgressIndex, direction: AnimationDirection = 'forward', startPoint: NormalizedPoint | null = null): AnimationRoute {
  const startArc = startPoint ? nearestPathPoint(index, toPathPoint(index.path, startPoint)).arc : null;
  return createAnimationRoute(index.totalLength, direction, startArc);
}
