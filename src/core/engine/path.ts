import type { OneLinePath, OneLinePathMeta, Point, Size } from '../models';

/** Build a path from points in drawing order. */
export function createPath(points: readonly Point[], bounds: Size, meta: OneLinePathMeta): OneLinePath {
  const coords = new Float32Array(points.length * 2);
  points.forEach((p, i) => {
    coords[i * 2] = p.x;
    coords[i * 2 + 1] = p.y;
  });
  return { coords, bounds, meta };
}

export function pointCount(path: OneLinePath): number {
  return path.coords.length >> 1;
}

export function pointAt(path: OneLinePath, index: number): Point {
  const n = pointCount(path);
  if (!Number.isInteger(index) || index < 0 || index >= n) {
    throw new RangeError(`Point index ${index} out of range [0, ${n})`);
  }
  return { x: path.coords[index * 2] as number, y: path.coords[index * 2 + 1] as number };
}

/** Iterates points in drawing order. */
export function* iteratePoints(path: OneLinePath): Generator<Point> {
  for (let i = 0, n = pointCount(path); i < n; i++) yield pointAt(path, i);
}

/** Cumulative arc length per point; `[0] = 0`, last entry = total length. */
export function cumulativeLengths(path: OneLinePath): Float64Array {
  const n = pointCount(path);
  const out = new Float64Array(n);
  const c = path.coords;
  for (let i = 1; i < n; i++) {
    const dx = (c[i * 2] as number) - (c[i * 2 - 2] as number);
    const dy = (c[i * 2 + 1] as number) - (c[i * 2 - 1] as number);
    out[i] = (out[i - 1] as number) + Math.hypot(dx, dy);
  }
  return out;
}

export function pathLength(path: OneLinePath): number {
  const lengths = cumulativeLengths(path);
  return lengths.length ? (lengths[lengths.length - 1] as number) : 0;
}

export function segmentCount(path: OneLinePath): number {
  return Math.max(0, pointCount(path) - 1);
}

export function startPoint(path: OneLinePath): Point {
  return pointAt(path, 0);
}

export function endPoint(path: OneLinePath): Point {
  return pointAt(path, pointCount(path) - 1);
}

export interface BoundingBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function boundingBox(path: OneLinePath): BoundingBox {
  const c = path.coords;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < c.length; i += 2) {
    const x = c[i]!, y = c[i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return c.length ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

/** Build a path directly from interleaved coordinates (no copy). */
export function pathFromCoords(coords: Float32Array, bounds: Size, meta: OneLinePathMeta): OneLinePath {
  return { coords, bounds, meta };
}

export interface PathValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Structural invariants every generated path must satisfy. A single
 * coordinate buffer is by construction one continuous line; this checks the rest.
 */
export function validatePath(path: OneLinePath): PathValidation {
  const errors: string[] = [];
  if (path.coords.length % 2 !== 0) errors.push('Coordinate buffer has odd length.');
  if (pointCount(path) < 2) errors.push('A line needs at least 2 points.');
  if (!(path.bounds.width > 0 && path.bounds.height > 0)) errors.push('Bounds must be positive.');
  for (let i = 0; i < path.coords.length; i++) {
    if (!Number.isFinite(path.coords[i])) {
      errors.push(`Non-finite coordinate at index ${i}.`);
      break;
    }
  }
  return { valid: errors.length === 0, errors };
}
