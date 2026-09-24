import { describe, expect, it } from 'vitest';
import {
  createAnimationRoute,
  createPath,
  createPathProgress,
  nearestPathPoint,
  penArcAt,
  routeFor,
  routeIntervals,
  toPathPoint,
  type AnimationRoute,
} from '../../../src/core';

/** Horizontal zigzag-free polyline: (0,0) → (10,0) → (10,10) → (0,10): length 30. */
const path = createPath(
  [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
  { width: 20, height: 20 },
  { generatorId: 't', generatorVersion: '1', seed: 0 },
);
const index = createPathProgress(path);

/** Union of intervals, merged; must be exactly [0, L] with total length L (every stretch once). */
function coverage(route: AnimationRoute, steps: number) {
  const pieces = [] as { a: number; b: number }[];
  for (let k = 0; k < steps; k++) pieces.push(...routeIntervals(route, k / steps, (k + 1) / steps));
  const total = pieces.reduce((s, p) => s + (p.b - p.a), 0);
  const sorted = [...pieces].sort((x, y) => x.a - y.a);
  let overlap = 0;
  for (let i = 1; i < sorted.length; i++) overlap += Math.max(0, sorted[i - 1]!.b - sorted[i]!.a);
  return { total, overlap, min: sorted[0]!.a, max: Math.max(...sorted.map((p) => p.b)) };
}

describe('animation route (order of drawing over the unchanged path)', () => {
  it('default: forward from the start = one piece, exactly the old behaviour', () => {
    const route = createAnimationRoute(30);
    expect(route.pieces).toEqual([{ from: 0, to: 30 }]);
    expect(routeIntervals(route, 0.2, 0.5)).toEqual([{ a: 6, b: 15 }]);
    expect(penArcAt(route, 0.5)).toBe(15);
  });

  it('reverse: from the end to the start', () => {
    const route = createAnimationRoute(30, 'reverse');
    expect(route.pieces).toEqual([{ from: 30, to: 0 }]);
    expect(routeIntervals(route, 0, 0.2)).toEqual([{ a: 24, b: 30 }]);
    expect(penArcAt(route, 1)).toBe(0);
  });

  it('start point: the path is played as a cycle (C→E, then A→C); the connection E→A is never drawn', () => {
    const forward = createAnimationRoute(30, 'forward', 12);
    expect(forward.pieces).toEqual([
      { from: 12, to: 30 },
      { from: 0, to: 12 },
    ]);
    expect(penArcAt(forward, 0)).toBe(12);
    expect(routeIntervals(forward, 0.5, 0.7)).toEqual([
      { a: 27, b: 30 },
      { a: 0, b: 3 },
    ]);
    const reverse = createAnimationRoute(30, 'reverse', 12);
    expect(reverse.pieces).toEqual([
      { from: 12, to: 0 },
      { from: 30, to: 12 },
    ]);
  });

  for (const [direction, start] of [
    ['forward', null],
    ['reverse', null],
    ['forward', 12],
    ['reverse', 12],
    ['forward', 0],
    ['reverse', 30],
    ['forward', 29.999],
  ] as const) {
    it(`${direction} from ${String(start)}: at the end every stretch is drawn exactly once`, () => {
      const c = coverage(createAnimationRoute(30, direction, start), 37);
      expect(c.total).toBeCloseTo(30, 9);
      expect(c.overlap).toBeCloseTo(0, 9);
      expect(c.min).toBeCloseTo(0, 9);
      expect(c.max).toBeCloseTo(30, 9);
    });
  }
});

/**
 * Phase 13.2, the cyclic order in the words of the requirement: a line
 * A → B → C → D → E → F (drawn from a closed tour, so F lies next to A)
 * started at D is drawn D → E → F → A → B → C → D. The pen lifts between
 * F and A (that connection is not part of the artwork).
 */
describe('13.2 start point D on A…F: cyclic order, same path', () => {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
  // A hexagon-like open ring; F is one step away from A.
  const vertices = [
    { x: 2, y: 2 },
    { x: 8, y: 2 },
    { x: 14, y: 2 },
    { x: 14, y: 8 },
    { x: 8, y: 8 },
    { x: 2, y: 8 },
  ];
  const ring = createPath(vertices, { width: 16, height: 10 }, { generatorId: 't', generatorVersion: '1', seed: 0 });
  const ringIndex = createPathProgress(ring);

  /** The vertices in the order the pen passes them: piece by piece, in drawing direction (consecutive duplicates removed). */
  function penOrder(route: AnimationRoute): string[] {
    const out: string[] = [];
    for (const { from, to } of route.pieces) {
      const lo = Math.min(from, to), hi = Math.max(from, to);
      const passed = letters.map((_, i) => i).filter((i) => ringIndex.cumulative[i]! >= lo - 1e-9 && ringIndex.cumulative[i]! <= hi + 1e-9);
      if (to < from) passed.reverse();
      for (const i of passed) if (out[out.length - 1] !== letters[i]) out.push(letters[i]!);
    }
    return out;
  }
  const pointD = { x: vertices[3]!.x / 16, y: vertices[3]!.y / 10 };

  it('default: A → … → F', () => {
    expect(penOrder(routeFor(ringIndex))).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('start D forward: D → E → F → A → B → C → D', () => {
    const route = routeFor(ringIndex, 'forward', pointD);
    expect(penOrder(route)).toEqual(['D', 'E', 'F', 'A', 'B', 'C', 'D']);
    // The jump F → A is never drawn: every drawn interval lies on the path.
    const drawn = routeIntervals(route, 0, 1);
    expect(drawn.reduce((sum, { a, b }) => sum + b - a, 0)).toBeCloseTo(ringIndex.totalLength, 9);
  });

  it('start D reverse: D → C → B → A → F → E → D', () => {
    expect(penOrder(routeFor(ringIndex, 'reverse', pointD))).toEqual(['D', 'C', 'B', 'A', 'F', 'E', 'D']);
  });

  it('a tap next to D starts at D (snapped onto the line)', () => {
    expect(penOrder(routeFor(ringIndex, 'forward', { x: pointD.x + 0.02, y: pointD.y + 0.05 }))[0]).toBe('D');
  });

  it('no path recomputation: the path object and its coordinates stay identical', () => {
    const before = Array.from(ring.coords);
    for (const direction of ['forward', 'reverse'] as const) routeFor(ringIndex, direction, pointD);
    expect(ringIndex.path).toBe(ring);
    expect(Array.from(ring.coords)).toEqual(before);
  });
});

describe('start point on the path', () => {
  it('a point near a segment snaps onto it (inside the segment)', () => {
    const near = nearestPathPoint(index, { x: 12, y: 4 });
    expect(near.point).toEqual({ x: 10, y: 4 });
    expect(near.arc).toBeCloseTo(14);
    expect(near.distance).toBeCloseTo(2);
  });

  it('a point far away from the path snaps to the closest point (here an end point)', () => {
    const far = nearestPathPoint(index, { x: -50, y: -50 });
    expect(far.point).toEqual({ x: 0, y: 0 });
    expect(far.arc).toBe(0);
    expect(far.distance).toBeCloseTo(Math.hypot(50, 50));
  });

  it('normalized image points map onto path coordinates (independent of any screen size)', () => {
    expect(toPathPoint(path, { x: 0.5, y: 0.25 })).toEqual({ x: 10, y: 5 });
    const route = routeFor(index, 'forward', { x: 0.5, y: 0.25 });
    expect(route.pieces[0]!.from).toBeCloseTo(15);
    expect(routeFor(index).pieces).toEqual([{ from: 0, to: 30 }]);
  });
});
