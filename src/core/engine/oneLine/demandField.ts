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

function checkLayer(analysis: ImageAnalysis, name: 'importance' | 'globalRelevance' | 'luminance' | 'contrast'): ScalarField {
  const layer = analysis[name];
  if (!layer || layer.width !== analysis.width || layer.height !== analysis.height || layer.data.length !== analysis.width * analysis.height) {
    throw new EngineError('invalid-analysis', `Layer ${name} is missing or inconsistent`);
  }
  return layer;
}

const smoothstep = (low: number, high: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

/** Luminance range over which an area counts as "light" (luminance 0..1): below LOW not at all, above HIGH fully. */
export const LIGHT_AREA_LUMINANCE = { low: 0.55, high: 0.85 } as const;

/**
 * Local contrast (standard deviation of luminance in the analysis window, the
 * raw `contrast` layer) that counts as structure: below LOW it is treated as
 * flat paper / sensor noise (denoised luminance), from HIGH on as clear
 * structure. ≈ 2–8 % lightness differences between neighbours. Luminance is
 * perceptual (L*), so the same scale serves light areas (lightDetail, 13.1)
 * and dark ones (structureToneBalance, 14.1).
 */
export const LIGHT_STRUCTURE_CONTRAST = { low: 0.008, high: 0.035 } as const;

/** Blurred structure from which a region counts as fully structured (absorbs float rounding of the blur). */
const FULL_STRUCTURE = 1 - 1e-4;

/**
 * Line demand per working-grid pixel, in (0, 1]:
 *
 *   tone   = (1 − luminance) · (1 − balance · (1 − region))  (balance = structureToneBalance,
 *                                                           region = structure blurred at the analysis' regionScale)
 *   s      = (1 − toneWeight) · importance/ref + toneWeight · tone
 *   s     *= (1 − globalModulation) + globalModulation · globalRelevance/ref
 *   s      = max(s, lightDetail · light(L) · structure)          (only with lightDetail)
 *   demand = floor + (1 − floor) · s^gamma
 *
 * Structure/tone balance: darkness alone is not information. Without it a
 * large flat dark area gets almost the demand of the motif (its tone term is
 * high, and darkness is also part of the analysis importance). With it, the
 * tone term counts fully only where there is local structure; on flat areas
 * a (1 − balance) share remains, so tone still shapes the drawing and the
 * line still runs through large areas — it is not an edge drawing. The
 * factor is ≤ 1: no pixel gets more demand than before; structured areas
 * gain only relatively (the point budget is fixed).
 *
 * `region` asks whether an AREA is structured, not whether a pixel lies next
 * to an edge: the contrast window marks a narrow band along every hard edge,
 * so without the blur a flat shape would be drawn as a hollow outline (an
 * edge drawing). The blur uses the analysis' own region scale (regionScale,
 * the scale of its region density), so "region" means the same in both.
 *
 * structure = smoothstep of the ABSOLUTE local contrast (raw contrast layer,
 * see LIGHT_STRUCTURE_CONTRAST): independent of the strongest edges in the
 * image, 0 on flat paper, and not diluted when the working grid is coarser
 * than thin edges. The max() only lifts light structured pixels; everything
 * else keeps its demand.
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

  // Light-area detail and structure/tone balance: absolute local contrast (the contrast layer is normalized by `reference`).
  const light = Math.min(1, Math.max(0, p.lightDetail ?? 0));
  const balance = Math.min(1, Math.max(0, p.structureToneBalance ?? 0));
  const contrastReference = analysis.meta.normalization.contrast?.reference;
  const contrast = (light > 0 || balance > 0) && contrastReference !== undefined ? resampleField(checkLayer(analysis, 'contrast'), size) : null;
  const structureAt = (i: number) => smoothstep(LIGHT_STRUCTURE_CONTRAST.low, LIGHT_STRUCTURE_CONTRAST.high, contrast!.data[i]! * contrastReference!);
  let region: Float32Array | null = null;
  if (contrast && balance > 0) {
    const structure = new Float32Array(size.width * size.height);
    for (let i = 0; i < structure.length; i++) structure[i] = structureAt(i);
    region = gaussianBlur({ ...size, data: structure }, analysis.meta.parameters.regionScale * Math.max(size.width, size.height)).data;
  }

  const data = new Float32Array(size.width * size.height);
  for (let i = 0; i < data.length; i++) {
    const imp = Math.min(1, importance.data[i]! / impRef);
    const g = Math.min(1, global.data[i]! / globalRef);
    // balance 0 ⇒ factor exactly 1 ⇒ bit-identical to the pre-14.1 demand.
    // A fully structured region (1 up to float rounding of the blur) keeps exactly its previous tone.
    const toneFactor = region ? 1 - balance * (region[i]! >= FULL_STRUCTURE ? 0 : 1 - region[i]!) : 1;
    let s = ((1 - tone) * imp + tone * (1 - luminance.data[i]!) * toneFactor) * (1 - mod + mod * g);
    if (contrast && light > 0) {
      s = Math.max(s, light * smoothstep(LIGHT_AREA_LUMINANCE.low, LIGHT_AREA_LUMINANCE.high, luminance.data[i]!) * structureAt(i));
    }
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
