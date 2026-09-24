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
      // Phase 13.1: faint but real structure in LIGHT areas (e.g. a white cup's rim, buildings
      // against a bright sky) gets line too; it was below the demand floor after the gamma.
      lightDetail: 0.8,
    },
  },
};

/** Presets ordered along the continuous detail axis (the anchors of the slider). */
export const DETAIL_ANCHORS: readonly OneLineDetailLevel[] = [...DETAIL_LEVELS].sort((a, b) => DETAIL_PROFILES[a].detail - DETAIL_PROFILES[b].detail);

/** The preset sitting exactly at `detail`, if any. */
export function detailLevelAt(detail: number): OneLineDetailLevel | null {
  return DETAIL_ANCHORS.find((level) => DETAIL_PROFILES[level].detail === detail) ?? null;
}

type Numeric = number | { readonly [key: string]: Numeric };

function lerpValue(a: Numeric, b: Numeric, t: number, integer: (key: string) => boolean, key: string): Numeric {
  if (typeof a === 'number' && typeof b === 'number') {
    const v = a + (b - a) * t;
    return integer(key) ? Math.round(v) : v;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    return Object.fromEntries(Object.keys(a).map((k) => [k, lerpValue(a[k]!, b[k]!, t, integer, `${key}.${k}`)]));
  }
  return a;
}

/**
 * Continuous detail: the full parameter sets of the two neighbouring presets
 * are interpolated linearly (integers rounded). Exactly at a preset the
 * preset's own parameters are returned unchanged; outside the anchors the
 * nearest preset's parameters apply (the line budget still follows `detail`).
 */
export function interpolateDetailParameters<P extends object>(
  detail: number,
  resolvePreset: (level: OneLineDetailLevel) => P,
  integer: (key: string) => boolean = () => false,
): P {
  const exact = detailLevelAt(detail);
  if (exact) return resolvePreset(exact);
  const first = DETAIL_ANCHORS[0]!;
  const last = DETAIL_ANCHORS[DETAIL_ANCHORS.length - 1]!;
  if (detail <= DETAIL_PROFILES[first].detail) return resolvePreset(first);
  if (detail >= DETAIL_PROFILES[last].detail) return resolvePreset(last);
  const upperIndex = DETAIL_ANCHORS.findIndex((level) => DETAIL_PROFILES[level].detail > detail);
  const lower = DETAIL_ANCHORS[upperIndex - 1]!;
  const upper = DETAIL_ANCHORS[upperIndex]!;
  const t = (detail - DETAIL_PROFILES[lower].detail) / (DETAIL_PROFILES[upper].detail - DETAIL_PROFILES[lower].detail);
  const a = resolvePreset(lower) as unknown as Record<string, Numeric>;
  const b = resolvePreset(upper) as unknown as Record<string, Numeric>;
  // Optional parameters present on one side only start from 0 on the other (e.g. lightDetail).
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return Object.fromEntries(keys.map((k) => [k, lerpValue(a[k] ?? 0, b[k] ?? 0, t, integer, k)])) as P;
}
