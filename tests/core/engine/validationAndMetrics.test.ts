import { describe, expect, it } from 'vitest';
import { computePathMetrics, countSelfIntersections, measureCoverage, validateOneLinePath, type OneLinePath } from '../../../src/core';

const path = (coords: number[], width = 100, height = 100): OneLinePath => ({
  coords: new Float32Array(coords),
  bounds: { width, height },
  meta: { generatorId: 'test', generatorVersion: '1', seed: 0 },
});

describe('validateOneLinePath', () => {
  it('accepts a proper line', () => {
    expect(validateOneLinePath(path([0, 0, 10, 10, 20, 5]))).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it.each([
    ['fewer than two points', path([5, 5]), /at least 2/],
    ['non-finite coordinates', path([0, 0, NaN, 3]), /Non-finite/],
    ['infinite coordinates', path([0, 0, Infinity, 3]), /Non-finite/],
    ['points outside the canvas', path([0, 0, 120, 3]), /outside/],
    ['negative coordinates', path([0, 0, -1, 3]), /outside/],
    ['zero length', path([4, 4, 4, 4]), /length must be > 0/],
    ['missing provenance', { ...path([0, 0, 1, 1]), meta: { generatorId: '', generatorVersion: '', seed: 0 } }, /provenance/],
  ])('rejects %s', (_, p, message) => {
    const report = validateOneLinePath(p);
    expect(report.valid).toBe(false);
    expect(report.errors.join(' ')).toMatch(message);
  });

  it('rejects jumps when a maximum segment length is given', () => {
    const report = validateOneLinePath(path([0, 0, 1, 1, 90, 90]), { maxSegmentLength: 20 });
    expect(report.errors.join(' ')).toMatch(/jumps/);
  });

  it('rejects many zero-length segments, warns about a few', () => {
    expect(validateOneLinePath(path([0, 0, 0, 0, 0, 0, 5, 5]), { maxZeroLengthShare: 0.1 }).valid).toBe(false);
    const few = validateOneLinePath(path([0, 0, 0, 0, 5, 5, 6, 6, 7, 7]));
    expect(few.valid).toBe(true);
    expect(few.warnings.join()).toMatch(/zero-length/);
  });
});

describe('path metrics', () => {
  it('measures length, segments, bounding box, start/end and turns', () => {
    const m = computePathMetrics(path([10, 10, 20, 10, 20, 20]));
    expect(m.length).toBeCloseTo(20);
    expect(m.pointCount).toBe(3);
    expect(m.segmentCount).toBe(2);
    expect(m.boundingBox).toEqual({ minX: 10, minY: 10, maxX: 20, maxY: 20 });
    expect(m.start).toEqual({ x: 10, y: 10 });
    expect(m.end).toEqual({ x: 20, y: 20 });
    expect(m.meanSegmentLength).toBeCloseTo(10);
    expect(m.maxSegmentLength).toBeCloseTo(10);
    expect(m.meanTurnAngle).toBeCloseTo(Math.PI / 2);
  });

  it('counts self-intersections', () => {
    expect(countSelfIntersections(path([0, 0, 10, 10, 10, 0, 0, 10]))).toBe(1); // "Z" crossing itself once
    expect(countSelfIntersections(path([0, 0, 10, 0, 10, 10, 0, 10]))).toBe(0); // open square
  });

  it('classifies coverage per cell (untouched / partial / sufficient)', () => {
    const demand = { width: 2, height: 1, data: new Float32Array([1, 1]) };
    // 2×2 cells; the line runs through the lower-left cell (index 2) only.
    const leftOnly = measureCoverage(path([5, 75, 45, 75], 100, 100), demand, 2);
    expect(leftOnly.counts.untouched).toBe(3);
    expect(leftOnly.states[2]).toBe('sufficient');
    // Uniform demand over all four cells; a loop through all four covers each equally.
    const uniform = { width: 2, height: 2, data: new Float32Array([1, 1, 1, 1]) };
    const both = measureCoverage(path([5, 25, 95, 25, 95, 75, 5, 75, 5, 30], 100, 100), uniform, 2);
    expect(both.counts.untouched).toBe(0);
    expect(both.demandCovered).toBe(1);
  });
});
