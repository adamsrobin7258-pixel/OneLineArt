import { describe, expect, it } from 'vitest';
import { DEFAULT_COLOR_SAMPLING, createPath, hashBytes, linearToOklab, sampleLineColors, SRGB_TO_LINEAR, type OneLinePath } from '../../../src/core';
import { raster } from '../../fixtures/rasters';

/** A horizontal meander across the image, many small steps. */
function meander(width: number, height: number, rows = 6): OneLinePath {
  const points = [];
  for (let r = 0; r < rows; r++) {
    const y = ((r + 0.5) / rows) * height;
    for (let i = 0; i <= 100; i++) points.push({ x: ((r % 2 ? 100 - i : i) / 100) * width, y });
  }
  return createPath(points, { width, height }, { generatorId: 'test', generatorVersion: '1', seed: 0 });
}

const lightnessOf = (rgb: Uint8ClampedArray, i: number) => linearToOklab(SRGB_TO_LINEAR[rgb[i * 3]!]!, SRGB_TO_LINEAR[rgb[i * 3 + 1]!]!, SRGB_TO_LINEAR[rgb[i * 3 + 2]!]!)[0];

describe('colour sampling along the line', () => {
  it('derives the colour from the image (red image ⇒ red line)', () => {
    const image = raster(200, 100, () => [220, 30, 30]);
    const colors = sampleLineColors(meander(200, 100), image, DEFAULT_COLOR_SAMPLING);
    for (let i = 0; i < colors.vertexCount; i++) {
      const [r, g, b] = [colors.rgb[i * 3]!, colors.rgb[i * 3 + 1]!, colors.rgb[i * 3 + 2]!];
      expect(r).toBeGreaterThan(g + 80);
      expect(r).toBeGreaterThan(b + 80);
    }
  });

  it('follows colour regions and changes smoothly between them', () => {
    const image = raster(200, 100, (x) => (x < 100 ? [200, 40, 40] : [40, 60, 200]));
    const path = meander(200, 100, 1);
    const smooth = sampleLineColors(path, image, DEFAULT_COLOR_SAMPLING);
    const hard = sampleLineColors(path, image, { ...DEFAULT_COLOR_SAMPLING, smoothing: 0, sampleRadius: 0 });
    const n = smooth.vertexCount;
    expect(smooth.rgb[0]!).toBeGreaterThan(smooth.rgb[2]!); // left: red
    expect(smooth.rgb[(n - 1) * 3 + 2]!).toBeGreaterThan(smooth.rgb[(n - 1) * 3]!); // right: blue
    const maxJump = (c: Uint8ClampedArray) => {
      let max = 0;
      for (let i = 1; i < n; i++) max = Math.max(max, Math.abs(c[i * 3]! - c[i * 3 - 3]!) + Math.abs(c[i * 3 + 2]! - c[i * 3 - 1]!));
      return max;
    };
    expect(maxJump(smooth.rgb)).toBeLessThan(maxJump(hard.rgb) / 3);
  });

  it('ignores isolated outlier pixels (robust mean)', () => {
    const image = raster(200, 100, (x, y) => ((x * 7 + y * 13) % 29 === 0 ? [255, 255, 255] : [30, 150, 60]));
    const colors = sampleLineColors(meander(200, 100), image, { ...DEFAULT_COLOR_SAMPLING, smoothing: 0 });
    for (let i = 0; i < colors.vertexCount; i++) expect(colors.rgb[i * 3 + 1]!).toBeGreaterThan(colors.rgb[i * 3]! + 40);
  });

  it('keeps the line readable: lightness within the configured range', () => {
    const image = raster(200, 100, (x) => (x < 100 ? [255, 255, 250] : [5, 5, 5]));
    const colors = sampleLineColors(meander(200, 100), image, DEFAULT_COLOR_SAMPLING);
    const { min, max } = DEFAULT_COLOR_SAMPLING.lightLightness;
    for (let i = 0; i < colors.vertexCount; i++) {
      const L = lightnessOf(colors.rgb, i);
      expect(L).toBeGreaterThanOrEqual(min - 0.02);
      expect(L).toBeLessThanOrEqual(max + 0.02);
    }
    const dark = sampleLineColors(meander(200, 100), image, DEFAULT_COLOR_SAMPLING, true);
    for (let i = 0; i < dark.vertexCount; i++) expect(lightnessOf(dark.rgb, i)).toBeGreaterThanOrEqual(DEFAULT_COLOR_SAMPLING.darkLightness.min - 0.02);
  });

  it('strength 0 gives a neutral line', () => {
    const image = raster(200, 100, () => [220, 30, 30]);
    const colors = sampleLineColors(meander(200, 100), image, { ...DEFAULT_COLOR_SAMPLING, strength: 0 });
    expect(Math.abs(colors.rgb[0]! - colors.rgb[1]!)).toBeLessThanOrEqual(2);
  });

  it('samples at stations along the arc length, not at every raw point', () => {
    const path = meander(400, 200);
    const colors = sampleLineColors(path, raster(400, 200, () => 128), DEFAULT_COLOR_SAMPLING);
    expect(colors.stations).toBeGreaterThan(10);
    // Never denser than the configured spacing, never denser than the smoothing can resolve.
    expect(colors.stationSpacingPx).toBeGreaterThanOrEqual(DEFAULT_COLOR_SAMPLING.stationSpacing * 400);
    expect(colors.stationSpacingPx).toBeGreaterThanOrEqual((DEFAULT_COLOR_SAMPLING.smoothing * 400) / 4 - 1e-9);
    expect(colors.vertexCount).toBe(path.coords.length / 2);
  });

  it('is deterministic and changes neither the image nor the path', () => {
    const image = raster(160, 120, (x, y) => [(x * 3) % 256, (y * 5) % 256, ((x + y) * 7) % 256]);
    const path = meander(160, 120);
    const imageHash = hashBytes(image.data);
    const pathHash = hashBytes(new Uint8Array(path.coords.buffer));
    const a = sampleLineColors(path, image, DEFAULT_COLOR_SAMPLING);
    const b = sampleLineColors(path, image, DEFAULT_COLOR_SAMPLING);
    expect(a.rgb).toEqual(b.rgb);
    expect(hashBytes(image.data)).toBe(imageHash);
    expect(hashBytes(new Uint8Array(path.coords.buffer))).toBe(pathHash);
  });

  it('maps path coordinates onto an image of another size', () => {
    const image = raster(50, 25, (x) => (x < 25 ? [200, 30, 30] : [30, 30, 200]));
    const colors = sampleLineColors(meander(200, 100, 1), image, { ...DEFAULT_COLOR_SAMPLING, smoothing: 0 });
    expect(colors.rgb[0]!).toBeGreaterThan(colors.rgb[2]!);
    expect(colors.rgb[(colors.vertexCount - 1) * 3 + 2]!).toBeGreaterThan(colors.rgb[(colors.vertexCount - 1) * 3]!);
  });
});
