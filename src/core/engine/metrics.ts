import type { OneLinePath, Point, ScalarField } from '../models';
import { boundingBox, endPoint, pointCount, startPoint, type BoundingBox } from './path';
import { measureCoverage, type CoverageReport } from './oneLine/coverage';

export interface PathMetrics {
  readonly length: number;
  readonly pointCount: number;
  readonly segmentCount: number;
  readonly boundingBox: BoundingBox;
  readonly start: Point;
  readonly end: Point;
  readonly meanSegmentLength: number;
  readonly maxSegmentLength: number;
  /** Mean absolute turning angle per inner vertex, in radians. */
  readonly meanTurnAngle: number;
  /** Total absolute turning per unit length (rad/px): how "curly" the line is. */
  readonly curvaturePerLength: number;
  /** Proper self-intersections; null if the path is too large to count cheaply. */
  readonly selfIntersections: number | null;
  readonly coverage: CoverageReport | null;
  /** How well the line represents the analysis' important structures (level-independent reference). */
  readonly representation: ImportanceRepresentation | null;
}

/**
 * Representation of important structures, measured against the ANALYSIS
 * importance (not the engine's demand), so different detail levels are
 * compared against the same reference.
 */
export interface ImportanceRepresentation {
  /** Cells on the long edge of the measuring grid. */
  readonly cellsOnLongEdge: number;
  /** Share of high-importance cells (top 20 %) the line passes through at all. */
  readonly highImportanceTouched: number;
  /** Mean line length per px² in high-importance cells. */
  readonly highImportanceDensity: number;
  /** Mean line length per px² in all other cells. */
  readonly otherDensity: number;
}

/** Share of cells counted as high-importance. */
export const HIGH_IMPORTANCE_SHARE = 0.2;

export function measureImportanceRepresentation(path: OneLinePath, importance: ScalarField, cellsOnLongEdge = 96): ImportanceRepresentation {
  const report = measureCoverage(path, importance, cellsOnLongEdge);
  const order = [...report.target.keys()].sort((a, b) => report.target[b]! - report.target[a]! || a - b);
  const highCount = Math.max(1, Math.round(order.length * HIGH_IMPORTANCE_SHARE));
  const high = new Uint8Array(order.length);
  for (let i = 0; i < highCount; i++) high[order[i]!] = 1;
  const cellSize = Math.max(path.bounds.width, path.bounds.height) / cellsOnLongEdge;
  const area = cellSize * cellSize;
  let touched = 0, highLength = 0, otherLength = 0;
  for (let i = 0; i < order.length; i++) {
    if (high[i]) {
      if (report.deposited[i]! > 0) touched++;
      highLength += report.deposited[i]!;
    } else otherLength += report.deposited[i]!;
  }
  const others = Math.max(1, order.length - highCount);
  return {
    cellsOnLongEdge,
    highImportanceTouched: touched / highCount,
    highImportanceDensity: highLength / (highCount * area),
    otherDensity: otherLength / (others * area),
  };
}

export interface MetricsOptions {
  /** Demand/importance field spanning the canvas, for coverage. */
  readonly demand?: ScalarField;
  /** Analysis importance, for the level-independent representation metric. */
  readonly importance?: ScalarField;
  readonly coverageCells?: number;
  readonly maxSegmentsForIntersections?: number;
}

export function computePathMetrics(path: OneLinePath, options: MetricsOptions = {}): PathMetrics {
  const c = path.coords;
  const n = pointCount(path);
  let length = 0;
  let maxSeg = 0;
  let turnSum = 0;
  let turns = 0;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(c[i * 2]! - c[i * 2 - 2]!, c[i * 2 + 1]! - c[i * 2 - 1]!);
    length += d;
    if (d > maxSeg) maxSeg = d;
    if (i < n - 1) {
      const ax = c[i * 2]! - c[i * 2 - 2]!, ay = c[i * 2 + 1]! - c[i * 2 - 1]!;
      const bx = c[i * 2 + 2]! - c[i * 2]!, by = c[i * 2 + 3]! - c[i * 2 + 1]!;
      if ((ax || ay) && (bx || by)) {
        turnSum += Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
        turns++;
      }
    }
  }
  const segments = Math.max(0, n - 1);
  return {
    length,
    pointCount: n,
    segmentCount: segments,
    boundingBox: boundingBox(path),
    start: n ? startPoint(path) : { x: 0, y: 0 },
    end: n ? endPoint(path) : { x: 0, y: 0 },
    meanSegmentLength: segments ? length / segments : 0,
    maxSegmentLength: maxSeg,
    meanTurnAngle: turns ? turnSum / turns : 0,
    curvaturePerLength: length > 0 ? turnSum / length : 0,
    selfIntersections: segments <= (options.maxSegmentsForIntersections ?? 400_000) ? countSelfIntersections(path) : null,
    coverage: options.demand ? measureCoverage(path, options.demand, options.coverageCells ?? 48) : null,
    representation: options.importance ? measureImportanceRepresentation(path, options.importance) : null,
  };
}

/**
 * Counts proper crossings between non-adjacent segments using a uniform grid;
 * each crossing is counted once (in the cell containing the intersection point).
 */
export function countSelfIntersections(path: OneLinePath): number {
  const c = path.coords;
  const segs = (c.length >> 1) - 1;
  if (segs < 3) return 0;
  const { width, height } = path.bounds;
  let total = 0;
  for (let i = 0; i < segs; i++) total += Math.hypot(c[i * 2 + 2]! - c[i * 2]!, c[i * 2 + 3]! - c[i * 2 + 1]!);
  const cell = Math.max(1e-3, Math.max(total / segs, Math.sqrt((width * height) / segs)) * 2);
  const cols = Math.max(1, Math.ceil(width / cell) + 1);
  const rows = Math.max(1, Math.ceil(height / cell) + 1);
  const buckets = new Map<number, number[]>();
  const cellOf = (v: number, max: number) => Math.min(max - 1, Math.max(0, Math.floor(v / cell)));
  for (let i = 0; i < segs; i++) {
    const x0 = Math.min(c[i * 2]!, c[i * 2 + 2]!), x1 = Math.max(c[i * 2]!, c[i * 2 + 2]!);
    const y0 = Math.min(c[i * 2 + 1]!, c[i * 2 + 3]!), y1 = Math.max(c[i * 2 + 1]!, c[i * 2 + 3]!);
    for (let gy = cellOf(y0, rows); gy <= cellOf(y1, rows); gy++) {
      for (let gx = cellOf(x0, cols); gx <= cellOf(x1, cols); gx++) {
        const key = gy * cols + gx;
        let list = buckets.get(key);
        if (!list) buckets.set(key, (list = []));
        list.push(i);
      }
    }
  }
  let count = 0;
  for (const [key, list] of buckets) {
    const gx = key % cols, gy = Math.floor(key / cols);
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const i = list[a]!, j = list[b]!;
        if (Math.abs(i - j) < 2) continue;
        const hit = intersection(c, i, j);
        if (hit && cellOf(hit.x, cols) === gx && cellOf(hit.y, rows) === gy) count++;
      }
    }
  }
  return count;
}

function intersection(c: Float32Array, i: number, j: number): Point | null {
  const px = c[i * 2]!, py = c[i * 2 + 1]!, rx = c[i * 2 + 2]! - px, ry = c[i * 2 + 3]! - py;
  const qx = c[j * 2]!, qy = c[j * 2 + 1]!, sx = c[j * 2 + 2]! - qx, sy = c[j * 2 + 3]! - qy;
  const denom = rx * sy - ry * sx;
  if (denom === 0) return null;
  const t = ((qx - px) * sy - (qy - py) * sx) / denom;
  const u = ((qx - px) * ry - (qy - py) * rx) / denom;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return { x: px + t * rx, y: py + t * ry };
}
