import type { ScalarField } from '../../models';
import type { Random } from '../../utils';
import { buildPointGrid, nearestPoint } from './spatialGrid';

export interface Stipples {
  readonly xs: Float64Array;
  readonly ys: Float64Array;
}

/**
 * Stratified importance sampling: point i draws from the i-th equal slice of
 * the cumulative demand, so the count per area follows the demand closely
 * (no clumping by chance). Seeded, hence reproducible.
 */
export function sampleStipples(demand: ScalarField, count: number, rng: Random): Stipples {
  const { width, height, data } = demand;
  const cdf = new Float64Array(data.length);
  let total = 0;
  for (let i = 0; i < data.length; i++) cdf[i] = total += Math.max(0, data[i]!);
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  let cell = 0;
  for (let i = 0; i < count; i++) {
    const target = ((i + rng.next()) / count) * total;
    // Targets increase monotonically, so a forward scan is O(n + cells).
    while (cell < cdf.length - 1 && cdf[cell]! < target) cell++;
    xs[i] = Math.min(width, (cell % width) + rng.next());
    ys[i] = Math.min(height, Math.floor(cell / width) + rng.next());
  }
  return { xs, ys };
}

/**
 * Weighted Lloyd relaxation (Secord's weighted Voronoi stippling): every
 * point moves to the demand-weighted centroid of its Voronoi cell. The result
 * is an even, organic, grid-free distribution whose density follows demand.
 */
export function relaxStipples(demand: ScalarField, stipples: Stipples, iterations: number, shouldAbort: () => boolean): Stipples {
  const { width, height, data } = demand;
  const { xs, ys } = stipples;
  const n = xs.length;
  if (n === 0) return stipples;
  const spacing = Math.sqrt((width * height) / n);
  const sumW = new Float64Array(n);
  const sumX = new Float64Array(n);
  const sumY = new Float64Array(n);

  for (let it = 0; it < iterations; it++) {
    if (shouldAbort()) return stipples;
    const grid = buildPointGrid(xs, ys, width, height, spacing);
    sumW.fill(0);
    sumX.fill(0);
    sumY.fill(0);
    for (let y = 0; y < height; y++) {
      let previous = -1;
      const py = y + 0.5;
      for (let x = 0; x < width; x++) {
        const w = data[y * width + x]!;
        const px = x + 0.5;
        const nearest = nearestPoint(grid, xs, ys, px, py, null, previous);
        previous = nearest;
        sumW[nearest]! += w;
        sumX[nearest]! += w * px;
        sumY[nearest]! += w * py;
      }
    }
    for (let i = 0; i < n; i++) {
      if (sumW[i]! > 0) {
        xs[i] = Math.min(width, Math.max(0, sumX[i]! / sumW[i]!));
        ys[i] = Math.min(height, Math.max(0, sumY[i]! / sumW[i]!));
      }
    }
  }
  return stipples;
}
