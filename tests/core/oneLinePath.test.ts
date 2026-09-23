import { describe, expect, it } from 'vitest';
import { cumulativeLengths, iteratePoints, pathLength, pointAt, pointCount, validatePath } from '../../src/core';
import { pathFrom } from '../helpers';

describe('OneLinePath', () => {
  it('preserves the exact point order', () => {
    const points = [{ x: 5, y: 1 }, { x: 0, y: 0 }, { x: 9, y: 7 }, { x: 2, y: 3 }];
    const path = pathFrom(points);
    expect([...iteratePoints(path)]).toEqual(points);
    expect(pointAt(path, 2)).toEqual({ x: 9, y: 7 });
  });

  it('holds arbitrarily many points', () => {
    const n = 500_000;
    const points = Array.from({ length: n }, (_, i) => ({ x: i % 100, y: Math.floor(i / 100) % 100 }));
    const path = pathFrom(points);
    expect(pointCount(path)).toBe(n);
    expect(pointAt(path, n - 1)).toEqual(points[n - 1]);
    expect(validatePath(path).valid).toBe(true);
  });

  it('rejects out-of-range indices', () => {
    const path = pathFrom([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(() => pointAt(path, 2)).toThrow(RangeError);
    expect(() => pointAt(path, -1)).toThrow(RangeError);
  });

  it('computes cumulative arc length along the drawing order', () => {
    const path = pathFrom([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }]);
    expect([...cumulativeLengths(path)]).toEqual([0, 5, 11]);
    expect(pathLength(path)).toBe(11);
  });

  it('flags structurally invalid paths', () => {
    expect(validatePath(pathFrom([{ x: 0, y: 0 }])).valid).toBe(false);
    expect(validatePath(pathFrom([{ x: 0, y: 0 }, { x: NaN, y: 1 }])).valid).toBe(false);
    expect(validatePath(pathFrom([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0, 10)).valid).toBe(false);
  });
});
