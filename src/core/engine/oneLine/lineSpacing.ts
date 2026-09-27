import type { ImageAnalysis } from '../../imageAnalysis';
import type { ScalarField } from '../../models';
import { buildDemandField, pixelsPerDensePoint } from './demandField';
import { ENGINE_PARAMETER_LIMITS, POINT_BUDGET_LIMIT } from './parameterLimits';
import { pointBudgetFor, type OneLineEngineParameters } from './parameters';

/**
 * Line spacing of the Organic style (developed in phase 15.5, production since
 * phase 16; the technique is unchanged).
 *
 * The line visits demand points spread by weighted Voronoi stippling, so the
 * distance between neighbouring passes is about the point spacing, which is
 * ∝ 1/√(points) and smallest in the densest (dark, important) areas. A spacing
 * factor f (< 1 = closer) therefore needs 1/f² times the points:
 * - pointBudget × 1/f² (the demand shape, i.e. where the line goes, is kept);
 * - maxWorkingEdge × 1/f, so the adaptive working grid can still give every
 *   densest-area point `minPixelsPerDensePoint` grid pixels.
 * A floor keeps the densest area from getting closer than a given distance:
 * images whose dark areas are already dense get less extra line, or none.
 */
export interface LineSpacingPatch {
  readonly parameters: OneLineEngineParameters;
  /** Demand points requested at `detail` (before the engine's own limits). */
  readonly points: number;
  /** The wanted points exceeded the engine's safety limit (POINT_BUDGET_LIMIT): the spacing is larger than asked. */
  readonly limited: boolean;
}

/** The parameters for a spacing factor; factor 1 returns `base` itself. */
export function lineSpacingParameters(base: OneLineEngineParameters, factor: number, detail: number): LineSpacingPatch {
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

/** Long edge the floor is measured at: "1 px" is 1/800 of the picture's long edge (not a display pixel). */
export const SPACING_REFERENCE_EDGE = 800;

/**
 * Point spacing in the densest area of the demand, px at SPACING_REFERENCE_EDGE,
 * if `points` demand points are placed: √(Σ demand / (points · max demand)).
 * Known before the run; it tracks the measured 10 % pass spacing in dark areas.
 */
export function densestPointSpacing(demand: ScalarField, points: number): number {
  return (Math.sqrt(pixelsPerDensePoint(demand, points)) * SPACING_REFERENCE_EDGE) / Math.max(demand.width, demand.height);
}

/** The factor `factor`, but never so close that the densest area falls below `floor`; never above 1. */
export function limitedSpacingFactor(analysis: ImageAnalysis, base: OneLineEngineParameters, detail: number, factor: number, floor: number): number {
  const { demand } = buildDemandField(analysis, base);
  return floorLimited(demand, pointBudgetFor(base, detail), factor, floor);
}

const floorLimited = (demand: ScalarField, points: number, factor: number, floor: number) => Math.min(1, Math.max(factor, floor / densestPointSpacing(demand, points)));

/** Smallest spacing factor (the engine's limit for spacingFactor). */
const MIN_FACTOR = 0.3;

/**
 * Applies the optional line-spacing parameters (the engine's step 0). Without
 * them the parameters come back unchanged, so every setting made before
 * phase 16 gives exactly its old line. The returned parameters no longer
 * carry the spacing keys.
 *
 * Lead (phase 16, Detail): the floor holds back a level more the denser it
 * already is, so on a dense motif Detail could end up with about the points of
 * Balanced. With `spacingLead` ≥ 1 a level keeps at least that many times the
 * points of a reference level (the budget at detail `spacingLeadDetail` and
 * the factor `spacingLeadFactor`, with the same floor). The reference is estimated on this
 * level's own demand field (the levels' demand fields differ only slightly).
 */
export function applyLineSpacing(parameters: OneLineEngineParameters, analysis: ImageAnalysis, detail: number): OneLineEngineParameters {
  const { spacingFactor, spacingFloor, spacingLead, spacingLeadDetail, spacingLeadFactor, ...base } = parameters;
  if (spacingFactor === undefined) return parameters;
  const floor = spacingFloor ?? 0;
  const points = pointBudgetFor(base, detail);
  const demand = floor > 0 || spacingLead !== undefined ? buildDemandField(analysis, base).demand : null;
  let factor = floor > 0 && demand ? floorLimited(demand, points, spacingFactor, floor) : spacingFactor;
  if (demand && spacingLead !== undefined && spacingLead >= 1 && spacingLeadDetail !== undefined && spacingLeadFactor !== undefined && spacingLeadFactor > 0) {
    const referencePoints = pointBudgetFor(base, spacingLeadDetail);
    const reference = floor > 0 ? floorLimited(demand, referencePoints, spacingLeadFactor, floor) : spacingLeadFactor;
    const wanted = (spacingLead * referencePoints) / (reference * reference);
    if (points / (factor * factor) < wanted) factor = Math.max(MIN_FACTOR, Math.sqrt(points / wanted));
  }
  return lineSpacingParameters(base, factor, detail).parameters;
}

/** The parameters without the line-spacing keys (= the presets before phase 16). */
export function withoutLineSpacing(parameters: OneLineEngineParameters): OneLineEngineParameters {
  const { spacingFactor, spacingFloor, spacingLead, spacingLeadDetail, spacingLeadFactor, ...base } = parameters;
  void [spacingFactor, spacingFloor, spacingLead, spacingLeadDetail, spacingLeadFactor];
  return base;
}
