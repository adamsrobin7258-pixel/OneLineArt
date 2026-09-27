import { densestPointSpacing, limitedSpacingFactor, lineSpacingParameters, type LineSpacingPatch } from '../../engine';

/**
 * Phase 15.5 (EXPERIMENTAL): a smaller minimum distance between the passes of
 * the Organic line, as a pure parameter patch. Since phase 16 the technique
 * lives in the production engine (engine/oneLine/lineSpacing.ts, used through
 * the optional parameters spacingFactor / spacingFloor); the names of the
 * prototype are kept here for the test page and its tests.
 */
export type OrganicSpacingPatch = LineSpacingPatch;
export const organicSpacingParameters = lineSpacingParameters;
export { densestPointSpacing, limitedSpacingFactor };

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
