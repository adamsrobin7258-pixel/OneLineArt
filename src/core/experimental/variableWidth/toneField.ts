import { resampleField } from '../../engine/oneLine/demandField';
import { fitWithin } from '../../imageProcessing';
import { gaussianBlur, luminanceField, mapField, percentile } from '../../imageAnalysis';
import type { RasterImage, ScalarField, Size } from '../../models';
import type { VariableWidthParameters } from './parameters';

/**
 * Tone field of the variable-width line: perceptual lightness (CIE L*, 0 = black,
 * 1 = white) on the working grid, prepared for sampling along the line.
 *
 *   1. luminance    area average in linear light → L*       (luminanceField, shared with the analysis)
 *   2. autoLevels   0.5 %…99.5 % percentiles → 0…1           (skipped for almost flat images)
 *   3. detail       L += detail · gate(L − blur(L, 2·spacing)) — local contrast, noise-gated
 *   4. contrast     S-curve (> 0) or compression towards mid-grey (< 0)
 *   5. smoothing    isotropic Gaussian, sigma = smoothing · spacing
 *
 * Why this order: the detail boost works on the untouched tones; the final
 * smoothing is also the anti-aliasing filter — the lines sample the field only
 * every `spacing` px across the line, so finer structure would alias (moiré).
 * It is isotropic, so it acts the same for every line direction.
 */
export interface ToneField {
  readonly field: ScalarField;
  /** Tonal range used by autoLevels (null: not applied). */
  readonly levels: { readonly low: number; readonly high: number } | null;
  /** Robust estimate of the pixel noise (L* units 0…1) that gates the detail boost. */
  readonly noiseSigma: number;
}

/** Below this tonal range (L* 0…1) autoLevels would only amplify noise: skipped. */
const MIN_LEVELS_RANGE = 0.1;
const LEVELS_PERCENTILES = { low: 0.005, high: 0.995 } as const;
/** Detail boost scale in units of the spacing (structures the lines can still show). */
const DETAIL_SCALE = 2;
/** Detail below NOISE_GATE × noise sigma is mostly suppressed (soft threshold). */
const NOISE_GATE = 3;
/** Lower bound of the gate (clean synthetic images have no noise). */
const MIN_GATE = 0.002;

export function workingGrid(image: Size, p: Pick<VariableWidthParameters, 'workingLongEdge'>): Size {
  // Unlike fitWithin, small images are scaled UP too: the spacing refers to the working grid.
  const scale = p.workingLongEdge / Math.max(image.width, image.height);
  return fitWithin({ width: Math.max(1, Math.round(image.width * scale)), height: Math.max(1, Math.round(image.height * scale)) }, p.workingLongEdge);
}

/** Contrast curve on 0…1; continuous, monotonic, f(0.5) = 0.5. */
export function contrastCurve(t: number, contrast: number): number {
  if (contrast > 0) {
    const k = 4 * contrast;
    return 0.5 + (0.5 * Math.tanh(k * (2 * t - 1))) / Math.tanh(k);
  }
  return 0.5 + (t - 0.5) * (1 + contrast);
}

/** Median absolute fine-scale residual, scaled to a Gaussian sigma. */
function estimateNoise(l: ScalarField): number {
  const fine = gaussianBlur(l, 1);
  const residual = mapField(l, (v, i) => Math.abs(v - fine.data[i]!));
  return 1.4826 * percentile(residual, 0.5);
}

export function buildToneField(image: RasterImage, p: VariableWidthParameters): ToneField {
  const size = workingGrid(image, p);
  // Shrinking: area average in linear light. Growing (small images): L* at the image size, then bilinear.
  const grows = size.width > image.width || size.height > image.height;
  let l = grows ? resampleField(luminanceField(image, image), size) : luminanceField(image, size);

  let levels: ToneField['levels'] = null;
  if (p.autoLevels) {
    const low = percentile(l, LEVELS_PERCENTILES.low);
    const high = percentile(l, LEVELS_PERCENTILES.high);
    if (high - low >= MIN_LEVELS_RANGE) {
      levels = { low, high };
      l = mapField(l, (v) => Math.min(1, Math.max(0, (v - low) / (high - low))));
    }
  }

  const noiseSigma = estimateNoise(l);
  if (p.detail > 0) {
    const base = gaussianBlur(l, DETAIL_SCALE * p.spacing);
    const tau = Math.max(MIN_GATE, NOISE_GATE * noiseSigma);
    const tau2 = tau * tau;
    l = mapField(l, (v, i) => {
      const h = v - base.data[i]!;
      const h2 = h * h;
      return Math.min(1, Math.max(0, v + (p.detail * h * h2) / (h2 + tau2)));
    });
  }

  if (p.contrast !== 0) l = mapField(l, (v) => contrastCurve(v, p.contrast));

  const sigma = p.smoothing * p.spacing;
  return { field: sigma > 0 ? gaussianBlur(l, sigma) : l, levels, noiseSigma };
}

/** Bilinear sample at working-grid coordinates (pixel centres at +0.5), edges clamped. */
export function sampleField(field: ScalarField, x: number, y: number): number {
  const { width, height, data } = field;
  const fx = Math.min(width - 1, Math.max(0, x - 0.5));
  const fy = Math.min(height - 1, Math.max(0, y - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const a = data[y0 * width + x0]!, b = data[y0 * width + x1]!, c = data[y1 * width + x0]!, d = data[y1 * width + x1]!;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
