import type { ImageAnalysis } from '../../imageAnalysis';
import { gaussianBlur, percentile } from '../../imageAnalysis';
import type { ScalarField, Size } from '../../models';
import { EngineError } from './errors';
import type { OneLineEngineParameters } from './parameters';

/**
 * Resamples a field to `target`: area average when shrinking, bilinear
 * interpolation when growing (the working grid may be finer than the
 * analysis, since the line is vector geometry).
 */
export function resampleField(field: ScalarField, target: Size): ScalarField {
  if (field.width === target.width && field.height === target.height) return field;
  if (target.width > field.width || target.height > field.height) {
    const data = new Float32Array(target.width * target.height);
    for (let y = 0; y < target.height; y++) {
      const fy = Math.min(field.height - 1, Math.max(0, ((y + 0.5) * field.height) / target.height - 0.5));
      const y0 = Math.floor(fy), y1 = Math.min(field.height - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < target.width; x++) {
        const fx = Math.min(field.width - 1, Math.max(0, ((x + 0.5) * field.width) / target.width - 0.5));
        const x0 = Math.floor(fx), x1 = Math.min(field.width - 1, x0 + 1), tx = fx - x0;
        const a = field.data[y0 * field.width + x0]!, b = field.data[y0 * field.width + x1]!;
        const c = field.data[y1 * field.width + x0]!, d = field.data[y1 * field.width + x1]!;
        data[y * target.width + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      }
    }
    return { ...target, data };
  }
  const sums = new Float64Array(target.width * target.height);
  const counts = new Uint32Array(target.width * target.height);
  for (let y = 0; y < field.height; y++) {
    const ty = Math.min(target.height - 1, Math.floor((y * target.height) / field.height));
    for (let x = 0; x < field.width; x++) {
      const t = ty * target.width + Math.min(target.width - 1, Math.floor((x * target.width) / field.width));
      sums[t]! += field.data[y * field.width + x]!;
      counts[t]!++;
    }
  }
  const data = new Float32Array(sums.length);
  for (let i = 0; i < data.length; i++) data[i] = counts[i] ? sums[i]! / counts[i]! : 0;
  return { ...target, data };
}

/** Working grid of a given long edge with the analysis' aspect ratio (may exceed the analysis size). */
export function workingSize(analysis: Size, longEdge: number): Size {
  const edge = Math.max(1, Math.floor(longEdge));
  const scale = edge / Math.max(analysis.width, analysis.height);
  return { width: Math.max(1, Math.round(analysis.width * scale)), height: Math.max(1, Math.round(analysis.height * scale)) };
}

function checkLayer(analysis: ImageAnalysis, name: 'importance' | 'globalRelevance' | 'luminance'): ScalarField {
  const layer = analysis[name];
  if (!layer || layer.width !== analysis.width || layer.height !== analysis.height || layer.data.length !== analysis.width * analysis.height) {
    throw new EngineError('invalid-analysis', `Layer ${name} is missing or inconsistent`);
  }
  return layer;
}

/**
 * Line demand per working-grid pixel, in (0, 1]:
 *
 *   s      = (1 − toneWeight) · importance/ref + toneWeight · (1 − luminance)
 *   s     *= (1 − globalModulation) + globalModulation · globalRelevance/ref
 *   demand = floor + (1 − floor) · s^gamma
 *
 * Global modulation damps isolated high-contrast specks and strengthens large
 * relevant shapes; the floor keeps the whole canvas in play without filling
 * empty areas.
 */
export interface DemandFields {
  /** Line demand per working-grid pixel in (0, 1]. */
  readonly demand: ScalarField;
  /** Global relevance resampled to the working grid (used to pick the start). */
  readonly global: ScalarField;
}

export function buildDemandField(analysis: ImageAnalysis, p: OneLineEngineParameters, longEdge?: number): DemandFields {
  if (!(analysis.width > 0 && analysis.height > 0)) throw new EngineError('invalid-analysis', 'Empty analysis');
  // Default: the analysis grid, reduced to workingMaxEdge. Larger edges are requested explicitly (adaptive growth).
  const size = workingSize(analysis, longEdge ?? Math.min(p.workingMaxEdge, Math.max(analysis.width, analysis.height)));
  const importance = resampleField(checkLayer(analysis, 'importance'), size);
  const global = resampleField(checkLayer(analysis, 'globalRelevance'), size);
  const luminance = resampleField(checkLayer(analysis, 'luminance'), size);

  const impRef = Math.max(percentile(importance, p.importanceReferencePercentile), 0.05);
  const globalRef = Math.max(percentile(global, p.importanceReferencePercentile), 0.05);
  const tone = Math.min(1, Math.max(0, p.toneWeight));
  const mod = Math.min(1, Math.max(0, p.globalModulation));
  const floor = Math.min(1, Math.max(0, p.demandFloor));

  const data = new Float32Array(size.width * size.height);
  for (let i = 0; i < data.length; i++) {
    const imp = Math.min(1, importance.data[i]! / impRef);
    const g = Math.min(1, global.data[i]! / globalRef);
    const s = ((1 - tone) * imp + tone * (1 - luminance.data[i]!)) * (1 - mod + mod * g);
    data[i] = floor + (1 - floor) * Math.pow(Math.min(1, Math.max(0, s)), p.demandGamma);
  }
  const demand: ScalarField = { ...size, data };
  const smoothing = Math.max(0, p.demandSmoothing) * Math.max(size.width, size.height);
  return { demand: smoothing > 0.3 ? gaussianBlur(demand, smoothing) : demand, global };
}

/**
 * Working-grid pixels per point in the densest area if `points` are
 * distributed over `demand` (≈ 1 / local point density at the maximum).
 */
export function pixelsPerDensePoint(demand: ScalarField, points: number): number {
  let total = 0;
  let max = 0;
  for (const v of demand.data) {
    total += v;
    if (v > max) max = v;
  }
  return max > 0 && points > 0 ? total / (points * max) : Infinity;
}

/**
 * Demand on the smallest working grid (≥ workingMaxEdge) that keeps the
 * densest area representable; bounded by maxWorkingEdge.
 */
export function buildAdaptiveDemandField(analysis: ImageAnalysis, p: OneLineEngineParameters, points: number): DemandFields {
  let fields = buildDemandField(analysis, p);
  const limit = Math.max(p.maxWorkingEdge, Math.max(fields.demand.width, fields.demand.height));
  let edge = Math.max(fields.demand.width, fields.demand.height);
  const need = Math.max(0, p.minPixelsPerDensePoint);
  for (let guard = 0; guard < 8 && edge < limit && pixelsPerDensePoint(fields.demand, points) < need; guard++) {
    // Pixel count grows with edge², so scale the edge by the square root of the shortfall.
    const factor = Math.sqrt(need / Math.max(1e-9, pixelsPerDensePoint(fields.demand, points)));
    edge = Math.min(limit, Math.ceil(edge * Math.max(1.25, factor)));
    fields = buildDemandField(analysis, p, edge);
  }
  return fields;
}
