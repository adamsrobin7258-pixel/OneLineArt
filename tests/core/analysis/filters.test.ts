import { describe, expect, it } from 'vitest';
import { boxBlur, createField, gaussianBlur, normalizeRobust, percentile, scharrGradient, type ScalarField } from '../../../src/core';

const field = (width: number, height: number, fn: (x: number, y: number) => number): ScalarField => {
  const f = createField({ width, height });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) f.data[y * width + x] = fn(x, y);
  return f;
};

describe('analysis filters', () => {
  it.each([0.5, 1, 2.5, 8, 40])('gaussian blur (σ=%s) keeps a constant field constant', (sigma) => {
    const out = gaussianBlur(field(50, 30, () => 0.42), sigma);
    for (const v of out.data) expect(v).toBeCloseTo(0.42, 5);
  });

  it('gaussian blur spreads an impulse symmetrically and preserves its mass', () => {
    const out = gaussianBlur(field(21, 21, (x, y) => (x === 10 && y === 10 ? 1 : 0)), 2);
    const sum = out.data.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 4);
    expect(out.data[10 * 21 + 8]).toBeCloseTo(out.data[10 * 21 + 12]!, 6);
    expect(out.data[8 * 21 + 10]).toBeCloseTo(out.data[12 * 21 + 10]!, 6);
  });

  it('box blur computes the window mean', () => {
    const out = boxBlur(field(5, 1, (x) => x), 1);
    expect(out.data[2]).toBeCloseTo(2, 6);
    expect(out.data[0]).toBeCloseTo((0 + 0 + 1) / 3, 6); // clamped edge
  });

  it('scharr measures the slope of a ramp exactly (per pixel)', () => {
    const { gx, gy, magnitude } = scharrGradient(field(10, 10, (x) => x * 0.05));
    expect(gx.data[5 * 10 + 5]).toBeCloseTo(0.05, 6);
    expect(gy.data[5 * 10 + 5]).toBeCloseTo(0, 6);
    expect(magnitude.data[5 * 10 + 5]).toBeCloseTo(0.05, 6);
  });

  it('percentile finds the robust maximum, ignoring rare outliers', () => {
    const f = field(100, 10, (x, y) => (x === 0 && y === 0 ? 100 : 0.5));
    expect(percentile(f, 0.99)).toBeLessThan(1);
    expect(percentile(f, 0.99)).toBeGreaterThan(0.45);
  });

  it('normalizeRobust uses the floor for weak signals, so noise is not amplified', () => {
    const weak = field(10, 10, () => 0.01);
    const { field: out, reference } = normalizeRobust(weak, 0.99, 0.1);
    expect(reference).toBe(0.1);
    expect(out.data[0]).toBeCloseTo(0.1, 5);
  });

  it('normalizeRobust handles an all-zero field', () => {
    const { field: out } = normalizeRobust(field(4, 4, () => 0), 0.99, 0);
    expect([...out.data].every((v) => v === 0)).toBe(true);
  });
});
