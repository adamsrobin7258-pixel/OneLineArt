import { describe, expect, it } from 'vitest';
import {
  AnimationError,
  createPath,
  createPathProgress,
  cursorAtProgress,
  hashBytes,
  pathLength,
  visibleLength,
  visiblePoints,
  type OneLinePath,
  type Point,
} from '../../../src/core';

const path = (points: Point[], w = 1000, h = 1000): OneLinePath => createPath(points, { width: w, height: h }, { generatorId: 't', generatorVersion: '1', seed: 0 });

// Very uneven segments: 1, 99, 0.5, 400, 0.5 (total 501).
const uneven = path([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0.5 }, { x: 100, y: 400.5 }, { x: 100.5, y: 400.5 }]);
const index = createPathProgress(uneven);

describe('progress along the real arc length', () => {
  it('0 → nothing drawn, 1 → the complete path', () => {
    expect(cursorAtProgress(index, 0)).toEqual({ index: 1, tip: null });
    expect(cursorAtProgress(index, 1)).toEqual({ index: 6, tip: null });
    expect(visiblePoints(index, cursorAtProgress(index, 0))).toHaveLength(1);
  });

  it.each([0.25, 0.5, 0.75])('%s → exactly that share of the path LENGTH (not of the point count)', (p) => {
    const cursor = cursorAtProgress(index, p);
    expect(visibleLength(index, cursor)).toBeCloseTo(p * 501, 9);
    // A point-count approach would be wildly off on these uneven segments.
    expect(Math.abs(cursor.index / 6 - p)).toBeGreaterThan(0.05);
  });

  it('draws complete segments before the position and the current one exactly up to it', () => {
    const cursor = cursorAtProgress(index, 50 / 501); // inside the 99 px segment
    expect(cursor.index).toBe(2); // points 0 and 1 complete
    expect(cursor.tip!.x).toBeCloseTo(50, 9);
    expect(cursor.tip!.y).toBe(0);
  });

  it('exactly at a segment boundary there is no duplicate tip', () => {
    const cursor = cursorAtProgress(index, 100 / 501); // arc length at point 2
    expect(cursor).toEqual({ index: 3, tip: null });
    const pts = visiblePoints(index, cursor);
    for (let i = 1; i < pts.length; i++) expect(pts[i]).not.toEqual(pts[i - 1]);
  });

  it.each([1e-9, 1e-4, 0.5, 1 - 1e-6, 1 - 1e-12])('no duplicate points at progress %s', (p) => {
    const pts = visiblePoints(index, cursorAtProgress(index, p));
    for (let i = 1; i < pts.length; i++) expect(pts[i]).not.toEqual(pts[i - 1]);
  });

  it('grows continuously: never backwards, no jumps between close progress values', () => {
    let previous = 0;
    for (let k = 0; k <= 5000; k++) {
      const len = visibleLength(index, cursorAtProgress(index, k / 5000));
      expect(len).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(len - previous).toBeLessThan(501 / 5000 + 1e-6); // exactly proportional steps, even across a 400 px segment
      previous = len;
    }
  });

  it('visible points are a prefix of the path plus the partial tip', () => {
    const pts = visiblePoints(index, cursorAtProgress(index, 0.6));
    const c = uneven.coords;
    for (let i = 0; i < pts.length - 1; i++) expect(pts[i]).toEqual({ x: c[i * 2], y: c[i * 2 + 1] });
  });

  it('matches pathLength and works for long paths efficiently', () => {
    const many = path(Array.from({ length: 200_000 }, (_, i) => ({ x: (i % 1000) + (i % 7) * 0.1, y: Math.floor(i / 1000) })));
    const big = createPathProgress(many);
    expect(big.totalLength).toBeCloseTo(pathLength(many), 3);
    const started = performance.now();
    for (let k = 0; k < 10_000; k++) cursorAtProgress(big, k / 10_000);
    expect(performance.now() - started).toBeLessThan(200); // binary search, not a walk from the start
  });
});

describe('edge cases', () => {
  it('two points and very short lines', () => {
    const two = createPathProgress(path([{ x: 0, y: 0 }, { x: 10, y: 0 }]));
    expect(cursorAtProgress(two, 0.5)).toEqual({ index: 1, tip: { x: 5, y: 0 } });
    const tiny = createPathProgress(path([{ x: 0, y: 0 }, { x: 1e-4, y: 0 }]));
    expect(visibleLength(tiny, cursorAtProgress(tiny, 0.5))).toBeCloseTo(5e-5, 10);
  });

  it('a zero-length path is complete as soon as it starts', () => {
    const still = createPathProgress(path([{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }]));
    expect(cursorAtProgress(still, 0)).toEqual({ index: 1, tip: null });
    expect(cursorAtProgress(still, 0.1)).toEqual({ index: 3, tip: null });
  });

  it('clamps out-of-range and infinite progress, rejects NaN', () => {
    expect(cursorAtProgress(index, -0.5)).toEqual(cursorAtProgress(index, 0));
    expect(cursorAtProgress(index, 7)).toEqual(cursorAtProgress(index, 1));
    expect(cursorAtProgress(index, Infinity)).toEqual(cursorAtProgress(index, 1));
    expect(cursorAtProgress(index, -Infinity)).toEqual(cursorAtProgress(index, 0));
    expect(() => cursorAtProgress(index, NaN)).toThrow(AnimationError);
  });

  it('rejects empty or invalid paths', () => {
    expect(() => createPathProgress(path([{ x: 0, y: 0 }]))).toThrow(AnimationError);
    expect(() => createPathProgress({ coords: new Float32Array([0, 0, NaN, 1]), bounds: { width: 1, height: 1 }, meta: { generatorId: 't', generatorVersion: '1', seed: 0 } })).toThrow(AnimationError);
  });

  it('is deterministic and never mutates the path', () => {
    const before = hashBytes(new Uint8Array(uneven.coords.buffer));
    const a = [0.1, 0.33, 0.9].map((p) => cursorAtProgress(index, p));
    const b = [0.1, 0.33, 0.9].map((p) => cursorAtProgress(createPathProgress(uneven), p));
    expect(a).toEqual(b);
    expect(hashBytes(new Uint8Array(uneven.coords.buffer))).toBe(before);
  });
});
