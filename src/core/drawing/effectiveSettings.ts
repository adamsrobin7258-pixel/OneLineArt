import {
  DEFAULT_ENGINE_PARAMETERS,
  EngineError,
  ONE_LINE_ENGINE_ID,
  ONE_LINE_ENGINE_VERSION,
  sanitizeEngineParameters,
  sanitizeOneLineSettings,
  type OneLineEngineParameters,
  type ParameterIssue,
} from '../engine';
import { DEFAULT_ONE_LINE_SETTINGS, type OneLineSettings } from '../models';
import { hashString } from '../utils';
import { DETAIL_LEVELS, DETAIL_PROFILES } from './detailLevels';
import { CROSSING_STYLE_PROFILES, CROSSING_STYLES, LINE_CHARACTER_PROFILES, LINE_CHARACTERS } from './drawingOptions';
import { DEFAULT_DRAWING_SETTINGS, type DrawingSettings } from './drawingSettings';
import { applyParameterPatches } from './parameterPatch';

/**
 * Everything the engine needs for one run, fully resolved and validated —
 * and everything needed to reproduce the artwork later (stored with projects).
 */
export interface EffectiveOneLineSettings {
  /** Normalized user choices. */
  readonly drawing: DrawingSettings;
  /** Per-run engine settings (seed, detail, maxPoints, start). */
  readonly settings: OneLineSettings;
  /** Final engine parameters: defaults ← detail profile ← options ← overrides, then clamped. */
  readonly parameters: OneLineEngineParameters;
  readonly engineId: string;
  readonly engineVersion: string;
  /** Stable identity of this configuration; results are cached and matched by it. */
  readonly key: string;
  /** Adjustments made while validating (empty for the built-in profiles). */
  readonly issues: readonly ParameterIssue[];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T, name: string, issues: ParameterIssue[]): T {
  if ((allowed as readonly unknown[]).includes(value)) return value as T;
  issues.push({ name, value, message: `${name} "${String(value)}" is not available; using "${fallback}"` });
  return fallback;
}

/** Canonical JSON (sorted keys) so equal configurations always hash equally. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * DetailProfile + options + UserOverrides → EffectiveOneLineSettings.
 * Unavailable options fall back to their defaults; parameters are validated
 * against the central safety limits (non-finite values throw).
 */
export function resolveOneLineSettings(
  input: Partial<DrawingSettings> = {},
  base: OneLineEngineParameters = DEFAULT_ENGINE_PARAMETERS,
  maxPoints: number = DEFAULT_ONE_LINE_SETTINGS.maxPoints,
): EffectiveOneLineSettings {
  const issues: ParameterIssue[] = [];
  const merged = { ...DEFAULT_DRAWING_SETTINGS, ...input };

  const detailLevel = oneOf(merged.detailLevel, DETAIL_LEVELS, DEFAULT_DRAWING_SETTINGS.detailLevel, 'detailLevel', issues);
  const availableCharacters = LINE_CHARACTERS.filter((c) => LINE_CHARACTER_PROFILES[c] !== null);
  const lineCharacter = oneOf(merged.lineCharacter, availableCharacters, DEFAULT_DRAWING_SETTINGS.lineCharacter, 'lineCharacter', issues);
  const availableCrossings = CROSSING_STYLES.filter((c) => CROSSING_STYLE_PROFILES[c] !== null);
  const crossingStyle = oneOf(merged.crossingStyle, availableCrossings, DEFAULT_DRAWING_SETTINGS.crossingStyle, 'crossingStyle', issues);
  const startPoint = merged.startPoint?.mode === 'fixed' ? merged.startPoint : { mode: 'auto' as const };

  const profile = DETAIL_PROFILES[detailLevel];
  const patched = applyParameterPatches(
    base,
    profile.parameters,
    LINE_CHARACTER_PROFILES[lineCharacter] ?? {},
    CROSSING_STYLE_PROFILES[crossingStyle] ?? {},
    merged.overrides ?? {},
  );
  const parameters = sanitizeEngineParameters(patched);
  issues.push(...parameters.issues);

  if (typeof merged.seed !== 'number' || !Number.isFinite(merged.seed)) {
    throw new EngineError('invalid-parameters', `seed must be a finite number (got ${String(merged.seed)})`);
  }
  const settings = sanitizeOneLineSettings({
    seed: merged.seed,
    detail: profile.detail,
    maxPoints,
    ...(startPoint.mode === 'fixed' ? { startPoint: { x: startPoint.x, y: startPoint.y } } : {}),
  });
  issues.push(...settings.issues);

  const drawing: DrawingSettings = {
    detailLevel,
    seed: settings.value.seed,
    lineCharacter,
    crossingStyle,
    startPoint: settings.value.startPoint ? { mode: 'fixed', ...settings.value.startPoint } : startPoint,
    overrides: merged.overrides ?? {},
  };
  const identity = canonical({
    engineId: ONE_LINE_ENGINE_ID,
    engineVersion: ONE_LINE_ENGINE_VERSION,
    settings: settings.value,
    parameters: parameters.value,
  });
  const key = `${detailLevel}-${hashString(identity).toString(16).padStart(8, '0')}${hashString(`${identity}#`).toString(16).padStart(8, '0')}`;

  return {
    drawing,
    settings: settings.value,
    parameters: parameters.value,
    engineId: ONE_LINE_ENGINE_ID,
    engineVersion: ONE_LINE_ENGINE_VERSION,
    key,
    issues,
  };
}

/** Effective settings of every detail level, keeping the other choices. */
export function resolveAllDetailLevels(drawing: Partial<DrawingSettings> = {}): Readonly<Record<(typeof DETAIL_LEVELS)[number], EffectiveOneLineSettings>> {
  return Object.fromEntries(DETAIL_LEVELS.map((level) => [level, resolveOneLineSettings({ ...drawing, detailLevel: level })])) as Record<
    (typeof DETAIL_LEVELS)[number],
    EffectiveOneLineSettings
  >;
}
