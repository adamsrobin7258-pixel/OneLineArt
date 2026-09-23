import { EngineError } from './errors';
import { buildPointGrid, kNearestNeighbors } from './spatialGrid';

/** Hilbert index of (x, y) on an n×n grid (n = power of two); curve runs (0,0) → (n−1,0). */
function hilbertIndex(n: number, x: number, y: number): number {
  let d = 0;
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      const t = x;
      x = y;
      y = t;
    }
  }
  return d;
}

/**
 * Index on a closed Moore curve over a 2n×2n grid: four Hilbert curves
 * (lower-left → upper-left → upper-right → lower-right) whose ends meet, so
 * consecutive indices are always spatially adjacent — including the wrap-around.
 */
export function mooreIndex(n: number, x: number, y: number): number {
  const right = x >= n ? 1 : 0;
  const upper = y >= n ? 1 : 0;
  const lx = x - right * n;
  const ly = y - upper * n;
  const quadrant = right ? (upper ? 2 : 3) : upper ? 1 : 0;
  const [u, v] = right ? [n - 1 - ly, lx] : [ly, n - 1 - lx];
  return quadrant * n * n + hilbertIndex(n, u, v);
}

/**
 * Initial route along a closed Moore space-filling curve, cut open at `start`.
 * Every edge is local by construction, so the route has no long jumps between
 * regions; the optimizer then refines it. O(n log n), deterministic.
 */
export function spaceFillingTour(xs: Float64Array, ys: Float64Array, width: number, height: number, start: number): Int32Array {
  const count = xs.length;
  const order = new Int32Array(count);
  if (count === 0) return order;
  // Grid fine enough that points rarely share a cell (half of the mean spacing).
  let n = 1;
  while (n * 2 < Math.min(1 << 15, Math.max(2, Math.ceil(Math.sqrt(count) * 2)))) n <<= 1;
  const size = 2 * n;
  const keys = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const gx = Math.min(size - 1, Math.max(0, Math.floor((xs[i]! / width) * size)));
    const gy = Math.min(size - 1, Math.max(0, Math.floor((ys[i]! / height) * size)));
    keys[i] = mooreIndex(n, gx, gy);
  }
  const sorted = Array.from({ length: count }, (_, i) => i).sort((a, b) => keys[a]! - keys[b]! || a - b);
  const offset = sorted.indexOf(start);
  for (let i = 0; i < count; i++) order[i] = sorted[(offset + i) % count]!;
  return order;
}

export interface TourOptimizationOptions {
  /** Cost of connecting two points; defaults to Euclidean distance. Must be symmetric. */
  readonly edgeCost?: (a: number, b: number) => number;
  readonly neighborCount: number;
  readonly curvaturePenalty: number;
  readonly maxMoves: number;
  readonly shouldAbort: () => boolean;
}

export interface TourOptimizationStats {
  readonly moves: number;
  readonly evaluations: number;
}

/**
 * 2-opt for an OPEN path with a fixed start, using neighbour lists and a
 * work queue ("don't-look bits"). Cost = edge cost (length, optionally
 * contour-aware) + curvaturePenalty · turn cost,
 * where turn cost at a vertex = (1 − cos θ)/2 · mean adjacent segment length.
 *
 * A move removes edges (p[x],p[x+1]) and (p[y],p[y+1]) and reverses p[x+1..y].
 * Only the turns at the four junction vertices change, so each move is O(1)
 * to evaluate. Crossings are removed whenever that shortens the route without
 * forcing sharp turns — the path never splits, since it stays one permutation.
 */
export function optimizeTour(xs: Float64Array, ys: Float64Array, order: Int32Array, width: number, height: number, options: TourOptimizationOptions): TourOptimizationStats {
  const n = order.length;
  if (n < 4) return { moves: 0, evaluations: 0 };
  const k = Math.max(1, Math.min(options.neighborCount, n - 1));
  const grid = buildPointGrid(xs, ys, width, height, Math.sqrt((width * height) / n));
  const neighbors = kNearestNeighbors(grid, xs, ys, k);
  const pos = new Int32Array(n);
  for (let i = 0; i < n; i++) pos[order[i]!] = i;
  const lambda = Math.max(0, options.curvaturePenalty);

  const dist = options.edgeCost ?? ((a: number, b: number) => Math.hypot(xs[a]! - xs[b]!, ys[a]! - ys[b]!));
  const at = (i: number) => (i >= 0 && i < n ? order[i]! : -1);
  const turn = (u: number, v: number, w: number): number => {
    if (u < 0 || w < 0 || lambda === 0) return 0;
    const ax = xs[v]! - xs[u]!, ay = ys[v]! - ys[u]!;
    const bx = xs[w]! - xs[v]!, by = ys[w]! - ys[v]!;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la === 0 || lb === 0) return 0;
    const cos = (ax * bx + ay * by) / (la * lb);
    return ((1 - cos) / 2) * ((la + lb) / 2);
  };

  /** Cost change of reversing order[x+1..y] (x ≥ 0, y ≥ x + 2). */
  const delta = (x: number, y: number): number => {
    const A = at(x), B = at(x + 1), C = at(y), D = at(y + 1);
    let d = dist(A, C) - dist(A, B);
    if (D >= 0) d += dist(B, D) - dist(C, D);
    if (lambda > 0) {
      const before = turn(at(x - 1), A, B) + turn(A, B, at(x + 2)) + turn(at(y - 1), C, D) + turn(C, D, at(y + 2));
      const after = turn(at(x - 1), A, C) + turn(A, C, at(y - 1)) + turn(at(x + 2), B, D) + turn(B, D, at(y + 2));
      d += lambda * (after - before);
    }
    return d;
  };

  const reverse = (from: number, to: number) => {
    for (let i = from, j = to; i < j; i++, j--) {
      const a = order[i]!, b = order[j]!;
      order[i] = b;
      order[j] = a;
      pos[b] = i;
      pos[a] = j;
    }
  };

  // Work queue of points whose surroundings may still be improvable.
  const queue = new Int32Array(n);
  const queued = new Uint8Array(n);
  let head = 0, size = 0;
  const push = (city: number) => {
    if (city < 0 || queued[city]) return;
    queued[city] = 1;
    queue[(head + size) % n] = city;
    size++;
  };
  for (let i = 0; i < n; i++) push(order[i]!);

  let moves = 0, evaluations = 0;
  const epsilon = 1e-9;
  while (size > 0 && moves < options.maxMoves) {
    if ((evaluations & 0x3fff) === 0 && options.shouldAbort()) throw new EngineError('aborted', 'Path optimization aborted');
    const a = queue[head]!;
    head = (head + 1) % n;
    size--;
    queued[a] = 0;

    let improved = false;
    for (let side = 0; side < 2 && !improved; side++) {
      const pa = pos[a]!;
      // side 0: replace edge (a, succ a); side 1: replace edge (pred a, a).
      const b = side === 0 ? at(pa + 1) : at(pa - 1);
      if (b < 0 || (side === 1 && pa - 1 < 0)) continue;
      const dab = dist(a, b);
      for (let q = 0; q < k; q++) {
        const c = neighbors[a * k + q]!;
        if (c < 0) break;
        if (dist(a, c) >= dab + (lambda > 0 ? dab : 0)) break;
        const pc = pos[c]!;
        let x: number, y: number;
        if (side === 0) {
          x = Math.min(pa, pc);
          y = Math.max(pa, pc);
        } else {
          if (pc - 1 < 0) continue;
          x = Math.min(pa, pc) - 1;
          y = Math.max(pa, pc) - 1;
        }
        if (x < 0 || y < x + 2) continue;
        evaluations++;
        if (delta(x, y) < -epsilon) {
          const touched = [at(x), at(x + 1), at(y), at(y + 1)];
          reverse(x + 1, y);
          moves++;
          for (const t of touched) push(t);
          improved = true;
          break;
        }
      }
    }
  }
  return { moves, evaluations };
}
