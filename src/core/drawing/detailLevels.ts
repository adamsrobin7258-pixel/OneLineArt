import type { EngineParameterPatch } from './parameterPatch';

/** The three user-facing detail levels. */
export const DETAIL_LEVELS = ['minimal', 'balanced', 'detail'] as const;
export type OneLineDetailLevel = (typeof DETAIL_LEVELS)[number];
export const DEFAULT_DETAIL_LEVEL: OneLineDetailLevel = 'balanced';

export interface DetailProfile {
  /** Position on the engine's continuous detail axis → line budget via pointBudget. */
  readonly detail: number;
  /** Engine parameters that change how the analysis is interpreted at this level. */
  readonly parameters: EngineParameterPatch;
}

/**
 * THE place where detail levels are defined (calibrated on real photos).
 * Balanced is the Part 4 engine default; Minimal and Detail differ not only
 * in line budget but in how much small structure the demand keeps, how local
 * vs. global relevance is weighed, and how much the line is smoothed/simplified.
 */
export const DETAIL_PROFILES: Readonly<Record<OneLineDetailLevel, DetailProfile>> = {
  minimal: {
    detail: 0.2,
    parameters: {
      // Large forms dominate: blur away small demand structure, weigh global relevance and tone more.
      demandSmoothing: 0.006,
      globalModulation: 0.35,
      toneWeight: 0.7,
      // Few lines must still read: stronger density contrast between shapes and background.
      demandGamma: 3.2,
      demandFloor: 0.006,
      // Calmer line: gentler turns, softer and more simplified geometry.
      curvaturePenalty: 0.6,
      smoothingIterations: 3,
      simplificationTolerance: 0.6,
    },
  },
  balanced: {
    detail: 0.5,
    parameters: {},
  },
  detail: {
    detail: 1,
    parameters: {
      // Small structures count: local importance over global, structure over tone,
      // and the extra line concentrates where the information is (higher gamma).
      globalModulation: 0.05,
      toneWeight: 0.4,
      demandGamma: 3,
      importanceReferencePercentile: 0.98,
      // Finer contour guidance, tighter turns allowed, less simplification.
      contourScale: 1.5,
      contourAlignment: 3.5,
      curvaturePenalty: 0.25,
      simplificationTolerance: 0.15,
    },
  },
};
