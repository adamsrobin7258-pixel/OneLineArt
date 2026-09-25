/** Bump whenever output for identical input + parameters changes. */
export const ONE_LINE_ENGINE_VERSION = '1.0.0';

/**
 * Every tunable of the One-Line engine in one place (no magic numbers in the
 * algorithm). Part 5 derives detail levels / line character from these.
 *
 * Units: "grid px" = working grid, "image px" = coordinates of the output path.
 */
export interface OneLineEngineParameters {
  // --- Working resolution -------------------------------------------------
  /** Long edge of the working grid used for demand and stippling (≤ analysis grid). */
  readonly workingMaxEdge: number;
  /**
   * Minimum working-grid pixels per point in the DENSEST area. Stippling cannot
   * represent more than ~1 point per pixel; if the densest area would drop
   * below this, the working grid grows (up to the analysis resolution).
   */
  readonly minPixelsPerDensePoint: number;
  /** Upper bound for the adaptive working grid (it may exceed the analysis grid; the line is vector geometry). */
  readonly maxWorkingEdge: number;

  // --- Line demand (how much line an area should receive) ----------------
  /** Weight of tone (darkness) vs. structural importance in the demand. */
  readonly toneWeight: number;
  /** How strongly global relevance modulates local demand (0 = ignore, 1 = multiply fully). */
  readonly globalModulation: number;
  /** >1 concentrates line in important areas, <1 spreads it. */
  readonly demandGamma: number;
  /** Minimum demand everywhere, so the whole canvas takes part (0..1). */
  readonly demandFloor: number;
  /**
   * Gaussian smoothing of the demand before stippling, as a fraction of the
   * working long edge (0 = off). Suppresses small details so large forms
   * dominate — the abstraction lever of a reduced detail level.
   */
  readonly demandSmoothing: number;
  /** Percentile used as the reference maximum for importance. */
  readonly importanceReferencePercentile: number;
  /**
   * Light-area detail (0..1, optional; absent = off, the pre-13.1 behaviour).
   * Lifts the demand of structure in BRIGHT areas that the other terms lose:
   * importance is normalized to the strongest edges of the image and tone
   * favours dark areas, so faint but real contours in light areas end up
   * below the demand floor after the gamma. Only local contrast above a
   * noise threshold counts (see buildDemandField).
   */
  readonly lightDetail?: number;
  /**
   * Structure/tone balance (0..1, optional; absent = 0, the pre-14.1 behaviour).
   * Share of the tone term that needs local structure: on a structureless
   * area the tone contributes only (1 − structureToneBalance) of its value,
   * on a structured one all of it. Large flat DARK areas (night sky, dark
   * wall, blurred background) thus stop competing with the motif merely by
   * being dark; dark detail keeps its demand. Never raises a demand above
   * the pre-14.1 value (see buildDemandField).
   */
  readonly structureToneBalance?: number;

  // --- Line budget ---------------------------------------------------------
  /** Number of demand points (≈ line budget) at detail 0 and detail 1. */
  readonly pointBudget: { readonly min: number; readonly max: number };

  // --- Stippling -----------------------------------------------------------
  /** Weighted Lloyd iterations: removes clumps and grid artefacts. */
  readonly relaxationIterations: number;

  // --- Path optimization ---------------------------------------------------
  /** Candidate neighbours per point for the tour optimization. */
  readonly neighborCount: number;
  /**
   * Extra cost for crossing a strong, coherent contour instead of running along
   * it (0 = off). Makes contours emerge as line runs without tracing them.
   */
  readonly contourAlignment: number;
  /** Integration scale of the contour orientation, in working px. */
  readonly contourScale: number;
  /** Cost of a turn relative to line length: 0 = shortest route, higher = smoother flow. */
  readonly curvaturePenalty: number;
  /** Deterministic safety cap for improvement moves, per point. */
  readonly maxMovesPerPoint: number;

  // --- Geometry post-processing ------------------------------------------
  /** Chaikin corner-cutting passes (0 = raw polyline). */
  readonly smoothingIterations: number;
  /** Chaikin cut ratio in (0, 0.5). */
  readonly smoothingRatio: number;
  /**
   * Douglas–Peucker tolerance in px at a 2048 px long edge; scaled with the
   * image so the line is equally fine at any source resolution.
   */
  readonly simplificationTolerance: number;

  // --- Validation / safety -------------------------------------------------
  /** Longest allowed segment as a fraction of the image diagonal (larger = a "jump"). */
  readonly maxSegmentFraction: number;
  /** Tolerated share of zero-length segments. */
  readonly maxZeroLengthShare: number;
}

export const DEFAULT_ENGINE_PARAMETERS: OneLineEngineParameters = {
  workingMaxEdge: 640,
  minPixelsPerDensePoint: 3,
  maxWorkingEdge: 1600,
  toneWeight: 0.6,
  globalModulation: 0.15,
  demandGamma: 2.6,
  demandFloor: 0.01,
  demandSmoothing: 0,
  importanceReferencePercentile: 0.995,
  // Phase 14.1 (Balanced); Minimal and Detail set their own value (detailLevels.ts).
  structureToneBalance: 0.6,
  pointBudget: { min: 4000, max: 40000 },
  relaxationIterations: 8,
  neighborCount: 8,
  contourAlignment: 3,
  contourScale: 2,
  curvaturePenalty: 0.35,
  maxMovesPerPoint: 60,
  smoothingIterations: 2,
  smoothingRatio: 0.25,
  simplificationTolerance: 0.3,
  maxSegmentFraction: 0.2,
  maxZeroLengthShare: 0.01,
};

/** Long edge the size-dependent parameters refer to. */
export const REFERENCE_LONG_EDGE = 2048;

/** Line budget for a detail value in [0, 1]. */
export function pointBudgetFor(parameters: OneLineEngineParameters, detail: number): number {
  const t = Math.min(1, Math.max(0, detail));
  return Math.round(parameters.pointBudget.min + (parameters.pointBudget.max - parameters.pointBudget.min) * t);
}
