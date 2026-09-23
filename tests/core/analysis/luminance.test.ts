import { describe, expect, it } from 'vitest';
import { luminanceField, perceptualLightness } from '../../../src/core';
import { checkerboard, raster, solid } from '../../fixtures/rasters';

describe('perceptual luminance', () => {
  it('maps black to 0 and white to 1', () => {
    expect(perceptualLightness(0, 0, 0)).toBe(0);
    expect(perceptualLightness(255, 255, 255)).toBeCloseTo(1, 6);
  });

  it('uses CIE L* (sRGB mid gray 128 ≈ L* 53.6), not the channel average', () => {
    expect(perceptualLightness(128, 128, 128)).toBeCloseTo(0.5359, 3);
  });

  it('weights channels perceptually: green > red > blue at equal values', () => {
    const r = perceptualLightness(255, 0, 0);
    const g = perceptualLightness(0, 255, 0);
    const b = perceptualLightness(0, 0, 255);
    expect(g).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(b);
    // A simple RGB average would rate all three equally (1/3).
    expect(g - b).toBeGreaterThan(0.5);
  });

  it('composites transparency over white (paper)', () => {
    expect(perceptualLightness(0, 0, 0, 0)).toBeCloseTo(1, 6);
    expect(perceptualLightness(0, 0, 0, 128)).toBeGreaterThan(0.4);
  });

  it('produces values in [0, 1] for every gray level', () => {
    for (let v = 0; v < 256; v++) {
      const l = perceptualLightness(v, v, v);
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThanOrEqual(1);
    }
  });

  it('is monotonic in gray level', () => {
    for (let v = 1; v < 256; v++) expect(perceptualLightness(v, v, v)).toBeGreaterThan(perceptualLightness(v - 1, v - 1, v - 1));
  });
});

describe('luminanceField (with downsampling)', () => {
  it('keeps full resolution when no downscaling is requested', () => {
    const img = raster(4, 2, (x) => x * 80);
    const field = luminanceField(img, { width: 4, height: 2 });
    expect(field.width).toBe(4);
    expect(field.data[3]).toBeCloseTo(perceptualLightness(240, 240, 240), 6);
  });

  it('averages area in linear light (a black/white checker is lighter than L* 0.5)', () => {
    const field = luminanceField(checkerboard(8, 8, 1), { width: 1, height: 1 });
    // Y = 0.5 → L* ≈ 76.1
    expect(field.data[0]).toBeCloseTo(0.7607, 3);
  });

  it('maps a uniform image to a uniform field', () => {
    const field = luminanceField(solid(30, 20, [200, 120, 40]), { width: 15, height: 10 });
    const expected = perceptualLightness(200, 120, 40);
    for (const v of field.data) expect(v).toBeCloseTo(expected, 5);
  });
});
