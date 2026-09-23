import type { ScalarField, Size } from '../models';

/** Allocates a zero-filled field. Allocation failures surface as RangeError. */
export function createField({ width, height }: Size): ScalarField {
  return { width, height, data: new Float32Array(width * height) };
}

export function mapField(field: ScalarField, fn: (value: number, index: number) => number): ScalarField {
  const out = createField(field);
  const src = field.data;
  const dst = out.data;
  for (let i = 0; i < src.length; i++) dst[i] = fn(src[i]!, i);
  return out;
}

/**
 * 1D running-mean box blur along one axis with edge clamping.
 * O(n) regardless of radius.
 */
type FloatBuffer = Float32Array | Float64Array;

function boxPass(src: FloatBuffer, dst: FloatBuffer, width: number, height: number, radius: number, horizontal: boolean): void {
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  const step = horizontal ? 1 : width;
  const lineStep = horizontal ? width : 1;
  const norm = 1 / (2 * radius + 1);
  const last = length - 1;
  for (let line = 0; line < lines; line++) {
    const base = line * lineStep;
    const first = src[base]!;
    const end = src[base + last * step]!;
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += src[base + (i < 0 ? 0 : i > last ? last : i) * step]!;
    for (let i = 0; i < length; i++) {
      dst[base + i * step] = sum * norm;
      const add = i + radius + 1;
      const remove = i - radius;
      sum += (add > last ? end : src[base + add * step]!) - (remove < 0 ? first : src[base + remove * step]!);
    }
  }
}

/** Box mean over a double-precision buffer (used where cancellation matters, e.g. variance). */
export function boxMean64(src: Float64Array, width: number, height: number, radius: number): Float64Array {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return src.slice();
  const tmp = new Float64Array(src.length);
  const out = new Float64Array(src.length);
  boxPass(src, tmp, width, height, r, true);
  boxPass(tmp, out, width, height, r, false);
  return out;
}

/** Box blur with square window of (2r+1)², edges clamped. */
export function boxBlur(field: ScalarField, radius: number): ScalarField {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return mapField(field, (v) => v);
  const tmp = new Float32Array(field.data.length);
  const out = createField(field);
  boxPass(field.data, tmp, field.width, field.height, r, true);
  boxPass(tmp, out.data, field.width, field.height, r, false);
  return out;
}

/** Radii of three successive box blurs approximating a Gaussian (W. Jarosz / Kovesi). */
function boxRadiiForGauss(sigma: number): [number, number, number] {
  const n = 3;
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  const upper = lower + 2;
  const m = Math.round((12 * sigma * sigma - n * lower * lower - 4 * n * lower - 3 * n) / (-4 * lower - 4));
  const sizes = [0, 1, 2].map((i) => (i < m ? lower : upper));
  return sizes.map((s) => (s - 1) / 2) as [number, number, number];
}

function gaussianKernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = w;
    sum += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i]! /= sum;
  return kernel;
}

function convolvePass(src: Float32Array, dst: Float32Array, width: number, height: number, kernel: Float32Array, horizontal: boolean): void {
  const radius = (kernel.length - 1) >> 1;
  const length = horizontal ? width : height;
  const lines = horizontal ? height : width;
  const step = horizontal ? 1 : width;
  const lineStep = horizontal ? width : 1;
  const last = length - 1;
  for (let line = 0; line < lines; line++) {
    const base = line * lineStep;
    for (let i = 0; i < length; i++) {
      let sum = 0;
      if (i >= radius && i + radius <= last) {
        // Interior: no clamping needed.
        let idx = base + (i - radius) * step;
        for (let k = 0; k < kernel.length; k++, idx += step) sum += src[idx]! * kernel[k]!;
      } else {
        for (let k = -radius; k <= radius; k++) {
          const j = i + k < 0 ? 0 : i + k > last ? last : i + k;
          sum += src[base + j * step]! * kernel[k + radius]!;
        }
      }
      dst[base + i * step] = sum;
    }
  }
}

/**
 * Gaussian blur, edges clamped. Small sigmas use an exact separable kernel
 * (fine structures), large sigmas three box passes (constant cost).
 */
export function gaussianBlur(field: ScalarField, sigma: number): ScalarField {
  if (!(sigma > 0)) return mapField(field, (v) => v);
  if (sigma <= 3) {
    const kernel = gaussianKernel(sigma);
    const tmp = new Float32Array(field.data.length);
    const out = createField(field);
    convolvePass(field.data, tmp, field.width, field.height, kernel, true);
    convolvePass(tmp, out.data, field.width, field.height, kernel, false);
    return out;
  }
  return boxRadiiForGauss(sigma).reduce((f, r) => boxBlur(f, r), field);
}

export interface Gradient {
  readonly gx: ScalarField;
  readonly gy: ScalarField;
  readonly magnitude: ScalarField;
}

/**
 * Scharr derivative (better rotational symmetry than Sobel), scaled to
 * luminance change per pixel. Edges clamped.
 */
export function scharrGradient(field: ScalarField): Gradient {
  const { width, height, data } = field;
  const gx = createField(field);
  const gy = createField(field);
  const magnitude = createField(field);
  for (let y = 0; y < height; y++) {
    const up = (y > 0 ? y - 1 : 0) * width;
    const mid = y * width;
    const down = (y < height - 1 ? y + 1 : y) * width;
    for (let x = 0; x < width; x++) {
      const l = x > 0 ? x - 1 : 0;
      const r = x < width - 1 ? x + 1 : x;
      const tl = data[up + l]!, tc = data[up + x]!, tr = data[up + r]!;
      const ml = data[mid + l]!, mr = data[mid + r]!;
      const bl = data[down + l]!, bc = data[down + x]!, br = data[down + r]!;
      const dx = (3 * (tr - tl) + 10 * (mr - ml) + 3 * (br - bl)) / 32;
      const dy = (3 * (bl - tl) + 10 * (bc - tc) + 3 * (br - tr)) / 32;
      const i = mid + x;
      gx.data[i] = dx;
      gy.data[i] = dy;
      magnitude.data[i] = Math.sqrt(dx * dx + dy * dy);
    }
  }
  return { gx, gy, magnitude };
}

const HISTOGRAM_BINS = 4096;

/**
 * Percentile of non-negative values via a fixed-size histogram: O(n),
 * deterministic, no sorting of large arrays.
 */
export function percentile(field: ScalarField, p: number): number {
  const data = field.data;
  let max = 0;
  for (let i = 0; i < data.length; i++) if (data[i]! > max) max = data[i]!;
  if (max === 0 || data.length === 0) return 0;
  const bins = new Uint32Array(HISTOGRAM_BINS);
  const scale = (HISTOGRAM_BINS - 1) / max;
  for (let i = 0; i < data.length; i++) bins[Math.floor(Math.max(0, data[i]!) * scale)]!++;
  const target = Math.min(data.length, Math.max(1, Math.ceil(p * data.length)));
  let seen = 0;
  for (let b = 0; b < HISTOGRAM_BINS; b++) {
    seen += bins[b]!;
    if (seen >= target) return (b + 1) / scale;
  }
  return max;
}

/** Maps raw ≥ 0 values to [0, 1] by a robust maximum with a lower floor. */
export function normalizeRobust(field: ScalarField, p: number, floor: number): { field: ScalarField; robustMax: number; reference: number } {
  const robustMax = percentile(field, p);
  const reference = Math.max(robustMax, floor, 1e-12);
  return { field: mapField(field, (v) => Math.min(1, Math.max(0, v / reference))), robustMax, reference };
}

export interface FieldStats {
  readonly min: number;
  readonly max: number;
  readonly mean: number;
}

export function fieldStats(field: ScalarField): FieldStats {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of field.data) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return field.data.length ? { min, max, mean: sum / field.data.length } : { min: 0, max: 0, mean: 0 };
}
