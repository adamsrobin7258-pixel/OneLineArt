import type { OneLinePath } from '../models';
import { tracePath } from '../rendering';

export interface PathValidationOptions {
  /** Longest acceptable segment (a longer one counts as a jump). Unchecked if omitted. */
  readonly maxSegmentLength?: number;
  /** Tolerated share of zero-length segments. Unchecked if omitted. */
  readonly maxZeroLengthShare?: number;
  /** Allowed overshoot beyond the bounds (float rounding). */
  readonly boundsTolerance?: number;
}

export interface PathValidationReport {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Full structural validation of a One-Line path, independent of any UI:
 *  1. at least two points            5. no invalid (non-finite) segments
 *  2. defined order (one buffer)     6. total length > 0
 *  3. all coordinates finite         7. no jumps (one connected stroke)
 *  4. all points inside the bounds   8. few zero-length segments
 *                                    9. renders as exactly one stroke
 */
export function validateOneLinePath(path: OneLinePath, options: PathValidationOptions = {}): PathValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const c = path.coords;
  const n = c.length >> 1;
  const tol = options.boundsTolerance ?? 1e-3;
  const { width, height } = path.bounds;

  if (!(c instanceof Float32Array) || c.length % 2 !== 0) errors.push('Coordinates must be one interleaved x/y buffer.');
  if (!path.meta?.generatorId) errors.push('Path has no provenance (generator).');
  if (n < 2) errors.push('A line needs at least 2 points.');
  if (!(width > 0 && height > 0)) errors.push('Bounds must be positive.');

  let firstNonFinite = -1;
  let firstOutside = -1;
  for (let i = 0; i < n; i++) {
    const x = c[i * 2]!, y = c[i * 2 + 1]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      if (firstNonFinite < 0) firstNonFinite = i;
      continue;
    }
    if ((x < -tol || y < -tol || x > width + tol || y > height + tol) && firstOutside < 0) firstOutside = i;
  }
  if (firstNonFinite >= 0) errors.push(`Non-finite coordinate at point ${firstNonFinite}.`);
  if (firstOutside >= 0) errors.push(`Point ${firstOutside} lies outside the ${width}×${height} canvas.`);

  let length = 0;
  let zeroSegments = 0;
  let longest = 0;
  let longestIndex = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(c[i * 2]! - c[i * 2 - 2]!, c[i * 2 + 1]! - c[i * 2 - 1]!);
    if (!Number.isFinite(d)) continue;
    length += d;
    if (d === 0) zeroSegments++;
    if (d > longest) {
      longest = d;
      longestIndex = i - 1;
    }
  }
  if (n >= 2 && firstNonFinite < 0 && !(length > 0)) errors.push('Path length must be > 0.');
  if (options.maxSegmentLength !== undefined && longest > options.maxSegmentLength) {
    errors.push(`Segment ${longestIndex} (${longest.toFixed(1)} px) exceeds ${options.maxSegmentLength.toFixed(1)} px: the stroke jumps.`);
  }
  const zeroShare = n > 1 ? zeroSegments / (n - 1) : 0;
  if (options.maxZeroLengthShare !== undefined && zeroShare > options.maxZeroLengthShare) {
    errors.push(`${(zeroShare * 100).toFixed(1)} % zero-length segments.`);
  } else if (zeroSegments > 0) {
    warnings.push(`${zeroSegments} zero-length segments.`);
  }

  // Renderability: a single moveTo followed by n − 1 lineTo.
  if (errors.length === 0) {
    let moves = 0;
    let lines = 0;
    tracePath(path, { moveTo: () => moves++, lineTo: () => lines++ });
    if (moves !== 1 || lines !== n - 1) errors.push(`Renders as ${moves} strokes / ${lines} segments instead of 1 / ${n - 1}.`);
  }

  return { valid: errors.length === 0, errors, warnings };
}
