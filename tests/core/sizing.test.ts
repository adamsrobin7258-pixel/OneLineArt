import { describe, expect, it } from 'vitest';
import { fitWithin, orientedSize } from '../../src/core';

describe('fitWithin (processing/preview resolution)', () => {
  it.each([
    ['1:1', 3000, 3000],
    ['4:3', 4032, 3024],
    ['3:4', 3024, 4032],
    ['16:9', 3840, 2160],
    ['9:16', 2160, 3840],
    ['extreme panorama', 12000, 1500],
  ])('preserves the %s aspect ratio', (_, width, height) => {
    const out = fitWithin({ width, height }, 2048);
    expect(Math.max(out.width, out.height)).toBe(2048);
    // Rounding may shift the short edge by at most half a pixel.
    const relativeError = Math.abs(out.width / out.height / (width / height) - 1);
    expect(relativeError).toBeLessThanOrEqual(0.5 / Math.min(out.width, out.height) + 1e-9);
  });

  it('never upscales', () => {
    expect(fitWithin({ width: 800, height: 600 }, 2048)).toEqual({ width: 800, height: 600 });
  });

  it('handles very large images (200 MP)', () => {
    expect(fitWithin({ width: 16320, height: 12240 }, 4096)).toEqual({ width: 4096, height: 3072 });
  });

  it('keeps at least one pixel on extreme ratios', () => {
    expect(fitWithin({ width: 100000, height: 10 }, 100).height).toBe(1);
  });
});

describe('orientedSize', () => {
  it('swaps dimensions for orientations 5–8 only', () => {
    for (const o of [1, 2, 3, 4]) expect(orientedSize({ width: 4, height: 3 }, o)).toEqual({ width: 4, height: 3 });
    for (const o of [5, 6, 7, 8]) expect(orientedSize({ width: 4, height: 3 }, o)).toEqual({ width: 3, height: 4 });
  });
});
