import { createRandom, type RasterImage } from '../../src/core';
import { raster } from './rasters';

/** Reproducible synthetic stand-ins for the motif categories (no photo assets in the repo). */

const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

/** Portrait: dark hair cap, light face with dark eyes and mouth, plain light background. */
export function portrait(w = 300, h = 400): RasterImage {
  return raster(w, h, (x, y) => {
    const cx = w / 2, cy = h * 0.5, rx = w * 0.28, ry = h * 0.3;
    if (inEllipse(x, y, cx - rx * 0.4, cy - ry * 0.15, rx * 0.16, ry * 0.07) || inEllipse(x, y, cx + rx * 0.4, cy - ry * 0.15, rx * 0.16, ry * 0.07)) return 25;
    if (inEllipse(x, y, cx, cy + ry * 0.45, rx * 0.35, ry * 0.06)) return 70;
    if (y < cy - ry * 0.55 && inEllipse(x, y, cx, cy - ry * 0.5, rx * 1.15, ry * 0.7)) return 35;
    if (inEllipse(x, y, cx, cy, rx, ry)) return 205;
    return 235;
  });
}

/** Landscape: sky gradient, rolling dark hills, lighter meadow. */
export function landscape(w = 400, h = 260): RasterImage {
  return raster(w, h, (x, y) => {
    const ridge = h * 0.45 + Math.sin(x / 37) * h * 0.08 + Math.sin(x / 11) * h * 0.02;
    if (y < ridge) return [150 + Math.round((y / h) * 80), 185 + Math.round((y / h) * 50), 230];
    if (y < ridge + h * 0.15) return [40, 70, 45];
    return [110, 150, 80];
  });
}

/** Architecture: facade with a regular window grid against the sky. */
export function architecture(w = 360, h = 300): RasterImage {
  return raster(w, h, (x, y) => {
    if (x > w * 0.2 && x < w * 0.8 && y > h * 0.15) {
      const wx = (x - w * 0.2) % 30, wy = (y - h * 0.15) % 34;
      return wx > 8 && wx < 22 && wy > 8 && wy < 24 ? 45 : 175;
    }
    return 225;
  });
}

/** Object on plain background: one dark disc on white. */
export function objectOnPlain(w = 320, h = 240): RasterImage {
  return raster(w, h, (x, y) => (inEllipse(x, y, w * 0.55, h * 0.5, h * 0.25, h * 0.25) ? 40 : 245));
}

/** Strongly structured scene: dense isotropic texture everywhere. */
export function structured(w = 320, h = 240, seed = 5): RasterImage {
  const rng = createRandom(seed);
  const v = Array.from({ length: w * h }, () => (rng.next() > 0.5 ? 50 : 200));
  return raster(w, h, (x, y) => v[y * w + x]!);
}

/** Very low contrast: faint shapes (±10 gray levels). */
export function lowContrast(w = 320, h = 240): RasterImage {
  return raster(w, h, (x, y) => (inEllipse(x, y, w * 0.4, h * 0.5, w * 0.2, h * 0.3) ? 128 : 138 + Math.round(Math.sin(x / 40) * 3)));
}

/** Very high contrast: large black/white blocks. */
export function highContrast(w = 320, h = 240): RasterImage {
  return raster(w, h, (x, y) => ((Math.floor(x / 80) + Math.floor(y / 80)) % 2 ? 0 : 255));
}

/** Nearly uniform: flat gray with slight sensor noise. */
export function nearlyUniform(w = 320, h = 240, seed = 9): RasterImage {
  const rng = createRandom(seed);
  const v = Array.from({ length: w * h }, () => 150 + Math.round((rng.next() - 0.5) * 4));
  return raster(w, h, (x, y) => v[y * w + x]!);
}

/** Rectangle with a strong border on white: the classic "only traces the contour" trap. */
export function strongRectangle(w = 400, h = 300): RasterImage {
  const x0 = w * 0.25, x1 = w * 0.75, y0 = h * 0.25, y1 = h * 0.75, t = 5;
  return raster(w, h, (x, y) => {
    const inOuter = x >= x0 - t && x <= x1 + t && y >= y0 - t && y <= y1 + t;
    const inInner = x > x0 + t && x < x1 - t && y > y0 + t && y < y1 - t;
    return inOuter && !inInner ? 0 : 255;
  });
}

export const MOTIFS = {
  portrait,
  landscape,
  architecture,
  objectOnPlain,
  structured,
  lowContrast,
  highContrast,
  nearlyUniform,
} as const;
