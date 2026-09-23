import type { ImageAnalysis } from '../../imageAnalysis';
import { gaussianBlur, mapField, percentile, scharrGradient } from '../../imageAnalysis';
import type { Size } from '../../models';
import { resampleField } from './demandField';

/**
 * Contour guidance on the working grid: the local contour direction (unit
 * tangent, perpendicular to the luminance gradient) and how strongly the line
 * should respect it (0..1 = edge strength × orientation coherence).
 */
export interface OrientationField extends Size {
  readonly tx: Float32Array;
  readonly ty: Float32Array;
  readonly strength: Float32Array;
}

/**
 * Structure tensor of the luminance, integrated over `sigma` working px.
 * The dominant eigenvector gives the gradient direction; the tangent is
 * perpendicular to it. Strength combines normalized gradient energy and
 * coherence, so textures (incoherent) do not steer the line — only contours do.
 */
export function buildOrientationField(analysis: ImageAnalysis, size: Size, sigma: number): OrientationField {
  const luminance = gaussianBlur(resampleField(analysis.luminance, size), 1);
  const { gx, gy } = scharrGradient(luminance);
  const jxx = gaussianBlur(mapField(gx, (v) => v * v), sigma);
  const jyy = gaussianBlur(mapField(gy, (v) => v * v), sigma);
  const jxy = gaussianBlur(mapField(gx, (v, i) => v * gy.data[i]!), sigma);
  const n = size.width * size.height;
  const tx = new Float32Array(n);
  const ty = new Float32Array(n);
  const energy = new Float32Array(n);
  const coherence = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = jxx.data[i]!, b = jxy.data[i]!, c = jyy.data[i]!;
    const trace = a + c;
    // Gradient direction angle φ = ½·atan2(2b, a − c); tangent is φ + 90°.
    const phi = 0.5 * Math.atan2(2 * b, a - c);
    tx[i] = -Math.sin(phi);
    ty[i] = Math.cos(phi);
    energy[i] = Math.sqrt(Math.max(0, trace));
    coherence[i] = trace > 1e-12 ? Math.min(1, Math.sqrt((a - c) * (a - c) + 4 * b * b) / trace) : 0;
  }
  const reference = Math.max(percentile({ ...size, data: energy }, 0.98), 1e-3);
  const strength = new Float32Array(n);
  for (let i = 0; i < n; i++) strength[i] = Math.min(1, energy[i]! / reference) * coherence[i]!;
  return { ...size, tx, ty, strength };
}

/** Upper bound of samples along one connection (keeps the cost O(1)). */
const MAX_COST_SAMPLES = 8;

/**
 * Cost of a straight connection: its length, increased wherever it crosses a
 * strong contour instead of following it, integrated along the segment:
 *   cost = Σ ℓᵢ · (1 + alignment · strengthᵢ · sin²(angle to tangentᵢ))
 * Sampling the whole segment (not just its midpoint) prevents long straight
 * connectors from slipping through contours. Symmetric, never below the length.
 */
export function contourAwareCost(field: OrientationField, alignment: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len === 0 || alignment <= 0) return len;
  const samples = Math.min(MAX_COST_SAMPLES, Math.max(1, Math.ceil(len)));
  const ux = dx / len, uy = dy / len;
  let penalty = 0;
  for (let k = 0; k < samples; k++) {
    const t = (k + 0.5) / samples;
    const mx = Math.min(field.width - 1, Math.max(0, Math.floor(x0 + dx * t)));
    const my = Math.min(field.height - 1, Math.max(0, Math.floor(y0 + dy * t)));
    const i = my * field.width + mx;
    const s = field.strength[i]!;
    if (s === 0) continue;
    const along = ux * field.tx[i]! + uy * field.ty[i]!;
    penalty += s * (1 - along * along);
  }
  return len * (1 + (alignment * penalty) / samples);
}
