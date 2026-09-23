import type { ScalarField } from '../models';
import { boxBlur, boxMean64, createField, gaussianBlur, mapField, type Gradient } from './filters';

/**
 * Local standard deviation of luminance in a (2r+1)² window: local, not global,
 * contrast. Accumulated in double precision so flat areas give exactly ~0.
 */
export function localContrastRaw(luminance: ScalarField, radius: number): ScalarField {
  const { width, height } = luminance;
  const values = Float64Array.from(luminance.data);
  const mean = boxMean64(values, width, height, radius);
  const meanSq = boxMean64(values.map((v) => v * v), width, height, radius);
  return mapField(luminance, (_, i) => Math.sqrt(Math.max(0, meanSq[i]! - mean[i]! * mean[i]!)));
}

const smoothstep = (low: number, high: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

/**
 * Density of significant changes: the fraction of pixels in the window whose
 * gradient is clearly above noise (soft threshold). Measures HOW MANY changes
 * there are, independent of how strong a single contour is — a lone edge
 * scores low, hair or foliage score high.
 */
export function detailDensityRaw(gradient: Gradient, radius: number, low: number, high: number): ScalarField {
  return boxBlur(mapField(gradient.magnitude, (m) => smoothstep(low, high, m)), radius);
}

/**
 * Texture from the structure tensor: gradient energy that has NO dominant
 * orientation. Contours and stripes are coherent (→ low), grass, gravel or
 * fabric are isotropic (→ high).
 *   J = Gσ * [gx², gx·gy; gx·gy, gy²],  coherence = (λ1 − λ2) / (λ1 + λ2)
 *   texture = sqrt(λ1 + λ2) · (1 − coherence)
 */
export function textureRaw(gradient: Gradient, sigma: number): ScalarField {
  const { gx, gy } = gradient;
  const jxx = gaussianBlur(mapField(gx, (v) => v * v), sigma);
  const jyy = gaussianBlur(mapField(gy, (v) => v * v), sigma);
  const jxy = gaussianBlur(mapField(gx, (v, i) => v * gy.data[i]!), sigma);
  const out = createField(gx);
  for (let i = 0; i < out.data.length; i++) {
    const a = jxx.data[i]!;
    const c = jyy.data[i]!;
    const b = jxy.data[i]!;
    const trace = a + c;
    if (trace <= 1e-12) continue;
    const coherence = Math.min(1, Math.sqrt((a - c) * (a - c) + 4 * b * b) / trace);
    out.data[i] = Math.sqrt(trace) * (1 - coherence);
  }
  return out;
}

/** Coarse center-surround difference of tone: where a region stands out from its surroundings. */
export function figureGroundRaw(luminance: ScalarField, centerSigma: number, surroundSigma: number): ScalarField {
  const center = gaussianBlur(luminance, centerSigma);
  const surround = gaussianBlur(luminance, surroundSigma);
  return mapField(center, (v, i) => Math.abs(v - surround.data[i]!));
}

/** Σ wᵢ·layerᵢ / Σ wᵢ, stays in [0, 1] when all layers do. */
export function weightedSum(layers: readonly (readonly [ScalarField, number])[]): ScalarField {
  const total = layers.reduce((s, [, w]) => s + Math.max(0, w), 0);
  const out = createField(layers[0]![0]);
  if (total <= 0) return out;
  for (const [field, weight] of layers) {
    const w = Math.max(0, weight) / total;
    if (w === 0) continue;
    for (let i = 0; i < out.data.length; i++) out.data[i]! += field.data[i]! * w;
  }
  for (let i = 0; i < out.data.length; i++) out.data[i] = Math.min(1, Math.max(0, out.data[i]!));
  return out;
}
