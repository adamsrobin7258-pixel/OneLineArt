import { createRandom, type RasterImage } from '../../src/core';

export type Rgb = readonly [number, number, number];

/** RGBA raster from a per-pixel color function. */
export function raster(width: number, height: number, color: (x: number, y: number) => Rgb | number, alpha = 255): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = color(x, y);
      const [r, g, b] = typeof c === 'number' ? [c, c, c] : c;
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = alpha;
    }
  }
  return { width, height, data };
}

export const solid = (width: number, height: number, color: Rgb | number) => raster(width, height, () => color);

/** Left half dark, right half light: one clean vertical contour. */
export const halfEdge = (width: number, height: number, dark = 30, light = 220) => raster(width, height, (x) => (x < width / 2 ? dark : light));

/** Fine vertical stripes: many changes, one orientation. */
export const stripes = (width: number, height: number, period = 6) => raster(width, height, (x) => (x % period < period / 2 ? 60 : 190));

/** Seeded binary noise: many changes, no orientation (grass/gravel-like texture). */
export function noiseTexture(width: number, height: number, seed = 7, low = 60, high = 190) {
  const rng = createRandom(seed);
  const values = Array.from({ length: width * height }, () => (rng.next() > 0.5 ? high : low));
  return raster(width, height, (x, y) => values[y * width + x]!);
}

/** Flat gray with slight sensor-like noise (±amplitude). */
export function noisyFlat(width: number, height: number, amplitude = 3, seed = 3) {
  const rng = createRandom(seed);
  const values = Array.from({ length: width * height }, () => 128 + Math.round((rng.next() - 0.5) * 2 * amplitude));
  return raster(width, height, (x, y) => values[y * width + x]!);
}

export const checkerboard = (width: number, height: number, cell: number, a = 0, b = 255) =>
  raster(width, height, (x, y) => ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? b : a));

export function copyRaster(image: RasterImage): RasterImage {
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}
