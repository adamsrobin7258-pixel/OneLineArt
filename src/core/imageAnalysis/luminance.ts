import type { RasterImage, ScalarField, Size } from '../models';
import { createField } from './filters';

/** sRGB 8-bit → linear light, as a lookup table (exact, deterministic). */
const SRGB_TO_LINEAR = (() => {
  const table = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    table[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  return table;
})();

/** CIE L* from relative luminance Y, scaled to [0, 1]. Perceptually uniform lightness. */
export function lightnessFromY(y: number): number {
  const l = y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
  return Math.min(1, Math.max(0, l / 100));
}

/** Perceptual lightness of one sRGB color (alpha composited over white, like paper). */
export function perceptualLightness(r: number, g: number, b: number, a = 255): number {
  const over = (c: number) => Math.round(c * (a / 255) + 255 * (1 - a / 255));
  const y = 0.2126 * SRGB_TO_LINEAR[over(r)]! + 0.7152 * SRGB_TO_LINEAR[over(g)]! + 0.0722 * SRGB_TO_LINEAR[over(b)]!;
  return lightnessFromY(y);
}

/**
 * Computes perceptual lightness while area-averaging into the analysis grid
 * in the same pass: no intermediate full-resolution float copy.
 * Averaging happens in linear light (Y) so downsampling is physically correct.
 */
export function luminanceField(image: RasterImage, target: Size): ScalarField {
  const { width: sw, height: sh, data } = image;
  const { width: tw, height: th } = target;
  const sums = new Float64Array(tw * th);
  const counts = new Uint32Array(tw * th);
  const colOf = new Uint32Array(sw);
  for (let x = 0; x < sw; x++) colOf[x] = Math.min(tw - 1, Math.floor((x * tw) / sw));

  for (let y = 0; y < sh; y++) {
    const rowBase = Math.min(th - 1, Math.floor((y * th) / sh)) * tw;
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      const a = data[i + 3]!;
      let yLin: number;
      if (a === 255) {
        yLin = 0.2126 * SRGB_TO_LINEAR[data[i]!]! + 0.7152 * SRGB_TO_LINEAR[data[i + 1]!]! + 0.0722 * SRGB_TO_LINEAR[data[i + 2]!]!;
      } else {
        const over = (c: number) => Math.round(c * (a / 255) + 255 * (1 - a / 255));
        yLin = 0.2126 * SRGB_TO_LINEAR[over(data[i]!)]! + 0.7152 * SRGB_TO_LINEAR[over(data[i + 1]!)]! + 0.0722 * SRGB_TO_LINEAR[over(data[i + 2]!)]!;
      }
      const t = rowBase + colOf[x]!;
      sums[t]! += yLin;
      counts[t]!++;
    }
  }

  const out = createField(target);
  for (let t = 0; t < out.data.length; t++) out.data[t] = lightnessFromY(counts[t] ? sums[t]! / counts[t]! : 1);
  return out;
}
