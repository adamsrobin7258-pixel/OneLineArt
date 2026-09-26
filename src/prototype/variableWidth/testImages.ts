import type { RasterImage } from '../../core';

function rasterOf(width: number, height: number, value: (x: number, y: number) => number): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.round(value(x, y));
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Pattern cell: rings, a diagonal bar and dots, ±1 around 0. */
function pattern(u: number, v: number): number {
  const r = Math.hypot(u - 0.5, v - 0.5);
  if (r < 0.42 && Math.floor(r * 14) % 2 === 0) return 1;
  if (Math.abs(u - v) < 0.04) return -1;
  if (Math.hypot(((u * 5) % 1) - 0.5, ((v * 5) % 1) - 0.5) < 0.12 && v > 0.8) return -1;
  return 0;
}

/**
 * Test chart (800 × 600): a black→white wedge on top, then rows of cells on
 * light, mid-grey and dark paper whose patterns get fainter to the right
 * (±24, ±12, ±6, ±3 grey levels) — shows how much faint detail survives in
 * light and in dark areas.
 */
export function testChart(): RasterImage {
  const W = 800, H = 600, wedge = 90, cols = 4, rows = 3;
  const levels = [232, 128, 34];
  const amplitudes = [24, 12, 6, 3];
  const cellW = W / cols, cellH = (H - wedge) / rows;
  return rasterOf(W, H, (x, y) => {
    if (y < wedge) return (255 * x) / (W - 1);
    const row = Math.min(rows - 1, Math.floor((y - wedge) / cellH));
    const col = Math.min(cols - 1, Math.floor(x / cellW));
    const u = (x - col * cellW) / cellW, v = (y - wedge - row * cellH) / cellH;
    return levels[row]! + amplitudes[col]! * pattern(u, v);
  });
}

/** Smooth radial light (a face-like highlight) on a vertical gradient: tests transitions without edges. */
export function softLight(): RasterImage {
  return rasterOf(700, 900, (x, y) => {
    const base = 40 + (180 * y) / 899;
    const glow = 200 * Math.exp(-((x - 350) ** 2 + (y - 380) ** 2) / (2 * 170 ** 2));
    return Math.min(255, base + glow);
  });
}

export const TEST_IMAGES = [
  { id: 'chart', label: 'Testtafel (helle/dunkle Details)', create: testChart },
  { id: 'soft', label: 'Weiche Übergänge', create: softLight },
] as const;
