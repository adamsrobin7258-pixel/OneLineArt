import type { OneLineSettings } from '../../models';
import { EngineError } from './errors';
import type { OneLineEngineParameters } from './parameters';

export interface NumericLimit {
  readonly min: number;
  readonly max: number;
  readonly integer?: boolean;
}

/** Required numeric parameters (optional ones are listed in OPTIONAL_PARAMETER_LIMITS). */
type ScalarKey = {
  [K in keyof OneLineEngineParameters]-?: undefined extends OneLineEngineParameters[K] ? never : OneLineEngineParameters[K] extends number ? K : never;
}[keyof OneLineEngineParameters];

/**
 * Safety limits for every engine parameter — the single place that bounds
 * what the engine will accept. Upper bounds keep memory and run time
 * controlled on phones; lower bounds keep the algorithm meaningful.
 */
export const ENGINE_PARAMETER_LIMITS: Readonly<Record<ScalarKey, NumericLimit>> = {
  workingMaxEdge: { min: 64, max: 2048, integer: true },
  minPixelsPerDensePoint: { min: 0, max: 16 },
  maxWorkingEdge: { min: 64, max: 3072, integer: true },
  toneWeight: { min: 0, max: 1 },
  globalModulation: { min: 0, max: 1 },
  demandGamma: { min: 0.25, max: 6 },
  demandFloor: { min: 0.0005, max: 1 },
  demandSmoothing: { min: 0, max: 0.05 },
  importanceReferencePercentile: { min: 0.5, max: 1 },
  relaxationIterations: { min: 0, max: 30, integer: true },
  neighborCount: { min: 2, max: 24, integer: true },
  contourAlignment: { min: 0, max: 10 },
  contourScale: { min: 0.5, max: 10 },
  curvaturePenalty: { min: 0, max: 5 },
  maxMovesPerPoint: { min: 0, max: 500, integer: true },
  smoothingIterations: { min: 0, max: 5, integer: true },
  smoothingRatio: { min: 0.05, max: 0.45 },
  simplificationTolerance: { min: 0, max: 5 },
  maxSegmentFraction: { min: 0.01, max: 1 },
  maxZeroLengthShare: { min: 0, max: 0.5 },
};

/** Optional parameters: validated only when present (absent keeps identities of older settings). */
export const OPTIONAL_PARAMETER_LIMITS = {
  lightDetail: { min: 0, max: 1 },
  structureToneBalance: { min: 0, max: 1 },
} as const satisfies Record<string, NumericLimit>;

/** Line budget bounds (demand points). */
export const POINT_BUDGET_LIMIT: NumericLimit = { min: 100, max: 120_000, integer: true };

export const SETTINGS_LIMITS = {
  seed: { min: 0, max: 0xffffffff, integer: true },
  detail: { min: 0, max: 1 },
  maxPoints: { min: 10, max: 500_000, integer: true },
  startPoint: { min: 0, max: 1 },
} as const satisfies Record<string, NumericLimit>;

export interface ParameterIssue {
  readonly name: string;
  readonly value: unknown;
  readonly message: string;
}

export interface Sanitized<T> {
  readonly value: T;
  /** Adjustments made (clamping, rounding, fixed combinations). Empty = input was valid. */
  readonly issues: readonly ParameterIssue[];
}

function sanitizeNumber(name: string, value: unknown, limit: NumericLimit, issues: ParameterIssue[]): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new EngineError('invalid-parameters', `${name} must be a finite number (got ${String(value)})`);
  }
  let v = limit.integer ? Math.round(value) : value;
  if (v < limit.min) v = limit.min;
  if (v > limit.max) v = limit.max;
  if (v !== value) issues.push({ name, value, message: `${name} adjusted to ${v} (allowed ${limit.min}…${limit.max}${limit.integer ? ', integer' : ''})` });
  return v;
}

/**
 * Validates engine parameters: non-finite values are rejected with a
 * controlled EngineError; out-of-range values are clamped; impossible
 * combinations are corrected. All adjustments are reported.
 */
export function sanitizeEngineParameters(parameters: OneLineEngineParameters): Sanitized<OneLineEngineParameters> {
  const issues: ParameterIssue[] = [];
  const out: Record<string, unknown> = { ...parameters };
  for (const [name, limit] of Object.entries(ENGINE_PARAMETER_LIMITS) as [ScalarKey, NumericLimit][]) {
    out[name] = sanitizeNumber(name, parameters[name], limit, issues);
  }
  for (const [name, limit] of Object.entries(OPTIONAL_PARAMETER_LIMITS)) {
    if ((parameters as unknown as Record<string, unknown>)[name] === undefined) delete out[name];
    else out[name] = sanitizeNumber(name, (parameters as unknown as Record<string, unknown>)[name], limit, issues);
  }
  let min = sanitizeNumber('pointBudget.min', parameters.pointBudget?.min, POINT_BUDGET_LIMIT, issues);
  let max = sanitizeNumber('pointBudget.max', parameters.pointBudget?.max, POINT_BUDGET_LIMIT, issues);
  if (min > max) {
    issues.push({ name: 'pointBudget', value: parameters.pointBudget, message: 'pointBudget.min > max: swapped' });
    [min, max] = [max, min];
  }
  out.pointBudget = { min, max };
  if ((out.maxWorkingEdge as number) < (out.workingMaxEdge as number)) {
    issues.push({ name: 'maxWorkingEdge', value: out.maxWorkingEdge, message: 'maxWorkingEdge < workingMaxEdge: raised to workingMaxEdge' });
    out.maxWorkingEdge = out.workingMaxEdge;
  }
  return { value: out as unknown as OneLineEngineParameters, issues };
}

/** Same policy for the per-run settings (seed, detail, maxPoints, start point). */
export function sanitizeOneLineSettings(settings: OneLineSettings): Sanitized<OneLineSettings> {
  const issues: ParameterIssue[] = [];
  const value: OneLineSettings = {
    seed: sanitizeNumber('seed', settings.seed, SETTINGS_LIMITS.seed, issues),
    detail: sanitizeNumber('detail', settings.detail, SETTINGS_LIMITS.detail, issues),
    maxPoints: sanitizeNumber('maxPoints', settings.maxPoints, SETTINGS_LIMITS.maxPoints, issues),
    ...(settings.startPoint
      ? {
          startPoint: {
            x: sanitizeNumber('startPoint.x', settings.startPoint.x, SETTINGS_LIMITS.startPoint, issues),
            y: sanitizeNumber('startPoint.y', settings.startPoint.y, SETTINGS_LIMITS.startPoint, issues),
          },
        }
      : {}),
  };
  return { value, issues };
}
