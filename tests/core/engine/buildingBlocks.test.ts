import { describe, expect, it } from 'vitest';
import {
  buildPointGrid,
  chaikinOpen,
  createRandom,
  dropDuplicatePoints,
  kNearestNeighbors,
  mooreIndex,
  nearestPoint,
  optimizeTour,
  relaxStipples,
  sampleStipples,
  simplifyPolyline,
  spaceFillingTour,
  type ScalarField,
} from '../../../src/core';

const randomPoints = (n: number, w: number, h: number, seed = 1) => {
  const rng = createRandom(seed);
  const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = rng.next() * w;
    ys[i] = rng.next() * h;
  }
  return { xs, ys };
};

const tourLength = (xs: Float64Array, ys: Float64Array, order: Int32Array) => {
  let l = 0;
  for (let i = 1; i < order.length; i++) l += Math.hypot(xs[order[i]!]! - xs[order[i - 1]!]!, ys[order[i]!]! - ys[order[i - 1]!]!);
  return l;
};

const isPermutation = (order: Int32Array) => new Set(order).size === order.length && [...order].every((v) => v >= 0 && v < order.length);

describe('spatial grid', () => {
  const { xs, ys } = randomPoints(500, 100, 60);
  const grid = buildPointGrid(xs, ys, 100, 60, 4);

  it('nearestPoint matches brute force', () => {
    const rng = createRandom(3);
    for (let q = 0; q < 200; q++) {
      const x = rng.next() * 100, y = rng.next() * 60;
      let best = -1, bestD = Infinity;
      for (let i = 0; i < 500; i++) {
        const d = (xs[i]! - x) ** 2 + (ys[i]! - y) ** 2;
        if (d < bestD) [best, bestD] = [i, d];
      }
      expect(nearestPoint(grid, xs, ys, x, y, null)).toBe(best);
    }
  });

  it('kNearestNeighbors matches brute force', () => {
    const k = 6;
    const knn = kNearestNeighbors(grid, xs, ys, k);
    for (const i of [0, 17, 250, 499]) {
      const brute = [...Array(500).keys()]
        .filter((j) => j !== i)
        .sort((a, b) => (xs[a]! - xs[i]!) ** 2 + (ys[a]! - ys[i]!) ** 2 - ((xs[b]! - xs[i]!) ** 2 + (ys[b]! - ys[i]!) ** 2))
        .slice(0, k);
      expect([...knn.subarray(i * k, i * k + k)]).toEqual(brute);
    }
  });
});

describe('Moore curve and initial route', () => {
  it.each([2, 4, 8, 16])('visits every cell of a %i-grid once, always stepping to an adjacent cell (incl. wrap-around)', (n) => {
    const size = 2 * n;
    const cells: [number, number][] = new Array(size * size);
    for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) cells[mooreIndex(n, x, y)] = [x, y];
    expect(cells.filter(Boolean)).toHaveLength(size * size);
    for (let i = 0; i < cells.length; i++) {
      const [ax, ay] = cells[i]!, [bx, by] = cells[(i + 1) % cells.length]!;
      expect(Math.abs(ax - bx) + Math.abs(ay - by)).toBe(1);
    }
  });

  it('builds a permutation that starts at the given point and has only local steps', () => {
    const { xs, ys } = randomPoints(2000, 200, 150, 4);
    const order = spaceFillingTour(xs, ys, 200, 150, 123);
    expect(isPermutation(order)).toBe(true);
    expect(order[0]).toBe(123);
    let longest = 0;
    for (let i = 1; i < order.length; i++) longest = Math.max(longest, Math.hypot(xs[order[i]!]! - xs[order[i - 1]!]!, ys[order[i]!]! - ys[order[i - 1]!]!));
    expect(longest).toBeLessThan(40); // mean spacing ≈ 3.9; no cross-canvas jumps
  });
});

describe('tour optimization (2-opt, open path, fixed start)', () => {
  const { xs, ys } = randomPoints(1500, 200, 150, 8);
  const initial = spaceFillingTour(xs, ys, 200, 150, 0);
  const options = { neighborCount: 8, curvaturePenalty: 0, maxMoves: 1e6, shouldAbort: () => false };

  it('keeps a permutation with the same start and shortens the route', () => {
    const order = initial.slice();
    const before = tourLength(xs, ys, order);
    optimizeTour(xs, ys, order, 200, 150, options);
    expect(isPermutation(order)).toBe(true);
    expect(order[0]).toBe(0);
    expect(tourLength(xs, ys, order)).toBeLessThan(before * 0.9);
  });

  it('is deterministic', () => {
    const a = initial.slice(), b = initial.slice();
    optimizeTour(xs, ys, a, 200, 150, options);
    optimizeTour(xs, ys, b, 200, 150, options);
    expect(a).toEqual(b);
  });

  it('a curvature penalty yields gentler turns', () => {
    const straight = initial.slice(), smooth = initial.slice();
    optimizeTour(xs, ys, straight, 200, 150, options);
    optimizeTour(xs, ys, smooth, 200, 150, { ...options, curvaturePenalty: 1 });
    const meanTurn = (order: Int32Array) => {
      let sum = 0;
      for (let i = 1; i < order.length - 1; i++) {
        const [a, b, c] = [order[i - 1]!, order[i]!, order[i + 1]!];
        const ax = xs[b]! - xs[a]!, ay = ys[b]! - ys[a]!, bx = xs[c]! - xs[b]!, by = ys[c]! - ys[b]!;
        sum += Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
      }
      return sum / (order.length - 2);
    };
    expect(meanTurn(smooth)).toBeLessThan(meanTurn(straight));
  });

  it('respects the move cap and the abort hook', () => {
    const order = initial.slice();
    expect(optimizeTour(xs, ys, order, 200, 150, { ...options, maxMoves: 5 }).moves).toBeLessThanOrEqual(5);
    expect(() => optimizeTour(xs, ys, initial.slice(), 200, 150, { ...options, shouldAbort: () => true })).toThrow(expect.objectContaining({ code: 'aborted' }));
  });
});

describe('stippling', () => {
  const demand: ScalarField = { width: 100, height: 50, data: new Float32Array(5000).map((_, i) => ((i % 100) < 50 ? 1 : 0.1)) };

  it('distributes points proportionally to demand, inside the grid, reproducibly', () => {
    const a = sampleStipples(demand, 2200, createRandom(2));
    relaxStipples(demand, a, 6, () => false);
    const b = sampleStipples(demand, 2200, createRandom(2));
    relaxStipples(demand, b, 6, () => false);
    expect(a.xs).toEqual(b.xs);
    let left = 0;
    for (let i = 0; i < a.xs.length; i++) {
      expect(a.xs[i]).toBeGreaterThanOrEqual(0);
      expect(a.xs[i]).toBeLessThanOrEqual(100);
      expect(a.ys[i]).toBeLessThanOrEqual(50);
      if (a.xs[i]! < 50) left++;
    }
    const ratio = left / (a.xs.length - left);
    expect(ratio).toBeGreaterThan(7);
    expect(ratio).toBeLessThan(13);
  });
});

describe('geometry', () => {
  const zigzag = new Float64Array([0, 0, 10, 10, 20, 0, 30, 10, 40, 0]);

  it('Chaikin keeps endpoints, never leaves the hull, doubles resolution per pass', () => {
    const out = chaikinOpen(zigzag, 2, 0.25);
    expect([out[0], out[1]]).toEqual([0, 0]);
    expect([out[out.length - 2], out[out.length - 1]]).toEqual([40, 0]);
    for (let i = 0; i < out.length; i += 2) {
      expect(out[i]).toBeGreaterThanOrEqual(0);
      expect(out[i]).toBeLessThanOrEqual(40);
      expect(out[i + 1]).toBeGreaterThanOrEqual(0);
      expect(out[i + 1]).toBeLessThanOrEqual(10);
    }
    expect(out.length >> 1).toBeGreaterThan(zigzag.length >> 1);
  });

  it('Douglas–Peucker keeps an ordered subset within tolerance', () => {
    const line = new Float64Array(200);
    for (let i = 0; i < 100; i++) {
      line[i * 2] = i;
      line[i * 2 + 1] = Math.sin(i / 10) * 5;
    }
    const out = simplifyPolyline(line, 0.5);
    expect(out.length).toBeLessThan(line.length);
    expect([out[0], out[out.length - 2]]).toEqual([0, 99]);
    for (let i = 2; i < out.length; i += 2) expect(out[i]!).toBeGreaterThan(out[i - 2]!); // order preserved
  });

  it('drops consecutive duplicates but keeps two points', () => {
    expect([...dropDuplicatePoints(new Float64Array([1, 1, 1, 1, 2, 2, 2, 2]))]).toEqual([1, 1, 2, 2]);
    expect(dropDuplicatePoints(new Float64Array([3, 3, 3, 3])).length).toBe(4);
  });
});
