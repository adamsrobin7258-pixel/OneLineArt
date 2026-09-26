import { ENGINE_PARAMETER_LIMITS, POINT_BUDGET_LIMIT, buildDemandField, pixelsPerDensePoint, pointBudgetFor, type OneLineEngineParameters } from '../../engine';
import type { ImageAnalysis } from '../../imageAnalysis';
import type { ScalarField } from '../../models';

/**
 * Phase 15.5 (EXPERIMENTAL, not used by the app): a smaller minimum distance
 * between the passes of the Organic line, as a pure parameter patch on the
 * UNCHANGED production engine.
 *
 * The Organic line has no explicit spacing: it visits demand points spread by
 * weighted Voronoi stippling, so the distance between neighbouring passes is
 * about the point spacing, and the point spacing is smallest in the densest
 * (dark, important) areas. Point spacing ∝ 1/√(points), so a spacing factor
 * f (< 1 = closer) needs 1/f² times the points:
 * - pointBudget × 1/f² (the demand shape, i.e. where the line goes, is kept);
 * - maxWorkingEdge × 1/f, so the adaptive working grid can still give every
 *   densest-area point `minPixelsPerDensePoint` grid pixels (stippling on a
 *   grid cannot place points closer than about one grid pixel).
 * Everything else (demand, gamma, contour guidance, tour, smoothing, seed)
 * stays exactly as it is; factor 1 returns the parameters unchanged.
 */
export interface OrganicSpacingPatch {
  readonly parameters: OneLineEngineParameters;
  /** Demand points requested at `detail` (before the engine's own limits). */
  readonly points: number;
  /** The wanted points exceeded the engine's safety limit (POINT_BUDGET_LIMIT): the spacing is larger than asked. */
  readonly limited: boolean;
}

export function organicSpacingParameters(base: OneLineEngineParameters, factor: number, detail: number): OrganicSpacingPatch {
  if (!(factor > 0) || !Number.isFinite(factor)) throw new RangeError(`Invalid spacing factor ${factor}`);
  if (factor === 1) return { parameters: base, points: pointBudgetFor(base, detail), limited: false };
  const scale = 1 / (factor * factor);
  const wanted = Math.round(pointBudgetFor(base, detail) * scale);
  const min = Math.round(base.pointBudget.min * scale), max = Math.round(base.pointBudget.max * scale);
  // Within the limit: scale the whole budget range (continuous detail keeps its meaning).
  // Otherwise: this detail's points directly, capped at the limit.
  const fits = max <= POINT_BUDGET_LIMIT.max;
  const points = Math.min(POINT_BUDGET_LIMIT.max, wanted);
  return {
    parameters: {
      ...base,
      pointBudget: fits ? { min, max } : { min: points, max: points },
      maxWorkingEdge: Math.min(ENGINE_PARAMETER_LIMITS.maxWorkingEdge.max, Math.max(base.maxWorkingEdge, Math.ceil(base.maxWorkingEdge / factor))),
    },
    points,
    limited: wanted > POINT_BUDGET_LIMIT.max,
  };
}

/**
 * Factor for an absolute target of the TYPICAL spacing (median pass spacing of
 * the whole line, px at 800 px, see passSpacing.ts) from the baseline's
 * median: the Organic counterpart of the constant Free Orthogonal spacing.
 * Never above 1 (no wider spacing than the baseline); 1 without a baseline.
 */
export function factorForTypicalSpacing(baselineMedian: number, target: number): number {
  if (!(target > 0)) throw new RangeError(`Invalid target spacing ${target}`);
  return baselineMedian > 0 ? Math.min(1, target / baselineMedian) : 1;
}

/**
 * Point spacing in the densest area of the demand, px at 800 px long edge,
 * if `points` demand points are placed: √(Σ demand / (points · max demand)).
 * The engine's own quantity (pixelsPerDensePoint), known BEFORE the run;
 * it tracks the measured 10 % pass spacing in dark areas (Phase 15.5).
 */
export function densestPointSpacing(demand: ScalarField, points: number): number {
  return (Math.sqrt(pixelsPerDensePoint(demand, points)) * 800) / Math.max(demand.width, demand.height);
}

/**
 * Limited reduction ("Boden"): the spacing factor `factor`, but never closer
 * than `floor` px (at 800 px) in the densest area. Images whose dark areas are
 * already dense get less extra line (or none); the factor never exceeds 1.
 */
export function limitedSpacingFactor(analysis: ImageAnalysis, base: OneLineEngineParameters, detail: number, factor: number, floor: number): number {
  const { demand } = buildDemandField(analysis, base);
  const densest = densestPointSpacing(demand, pointBudgetFor(base, detail));
  return Math.min(1, Math.max(factor, floor / densest));
}
