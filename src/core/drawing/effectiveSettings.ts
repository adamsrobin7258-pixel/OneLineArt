import {
  DEFAULT_ENGINE_PARAMETERS,
  ENGINE_PARAMETER_LIMITS,
  EngineError,
  SETTINGS_LIMITS,
  oneLineEngine,
  sanitizeEngineParameters,
  sanitizeOneLineSettings,
  type OneLineEngineParameters,
  type ParameterIssue,
} from '../engine';
import { DEFAULT_ONE_LINE_SETTINGS, type OneLineSettings } from '../models';
import { hashString } from '../utils';
import { DETAIL_LEVELS, DETAIL_PROFILES, detailLevelAt, interpolateDetailParameters, type OneLineDetailLevel } from './detailLevels';
import { CROSSING_STYLE_PROFILES, CROSSING_STYLES, LINE_CHARACTER_PROFILES, LINE_CHARACTERS } from './drawingOptions';
import { DRAWING_STYLE_PROFILES, DRAWING_STYLES } from './drawingStyles';
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
  /** Final engine parameters: defaults ← detail profile ← style ← options ← smoothing ← overrides, then clamped. */
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

/** Smoothing control range (Chaikin passes; the engine's own limit). */
export const SMOOTHING_RANGE = { min: ENGINE_PARAMETER_LIMITS.smoothingIterations.min, max: ENGINE_PARAMETER_LIMITS.smoothingIterations.max } as const;

const isIntegerParameter = (key: string) => (ENGINE_PARAMETER_LIMITS as Record<string, { integer?: boolean }>)[key]?.integer === true || key.startsWith('pointBudget.');

/** An optional user value: null stays null, invalid values fall back to null (reported), valid ones are clamped. */
function optionalValue(value: unknown, range: { min: number; max: number }, integer: boolean, name: string, issues: ParameterIssue[]): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push({ name, value, message: `${name} must be a finite number; using the preset value` });
    return null;
  }
  const v = Math.min(range.max, Math.max(range.min, integer ? Math.round(value) : value));
  if (v !== value) issues.push({ name, value, message: `${name} adjusted to ${v}` });
  return v;
}

/**
 * Whether the drawing deviates from its preset (shown as "custom" in the UI).
 * A smoothing value only counts for styles that smooth (it is kept for them).
 */
export const isCustomDrawing = (drawing: Pick<DrawingSettings, 'style' | 'detail' | 'smoothing'>): boolean =>
  drawing.detail !== null || (drawing.smoothing !== null && DRAWING_STYLE_PROFILES[drawing.style].smoothing);

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
 * DetailProfile (or continuous detail) + style + options + smoothing +
 * UserOverrides → EffectiveOneLineSettings.
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

  const requestedDetail = optionalValue(merged.detail, SETTINGS_LIMITS.detail, false, 'detail', issues);
  // A continuous value that lands exactly on a preset IS that preset.
  const anchored = requestedDetail === null ? null : detailLevelAt(requestedDetail);
  const detailLevel = anchored ?? oneOf(merged.detailLevel, DETAIL_LEVELS, DEFAULT_DRAWING_SETTINGS.detailLevel, 'detailLevel', issues);
  const availableCharacters = LINE_CHARACTERS.filter((c) => LINE_CHARACTER_PROFILES[c] !== null);
  const lineCharacter = oneOf(merged.lineCharacter, availableCharacters, DEFAULT_DRAWING_SETTINGS.lineCharacter, 'lineCharacter', issues);
  const availableCrossings = CROSSING_STYLES.filter((c) => CROSSING_STYLE_PROFILES[c] !== null);
  const crossingStyle = oneOf(merged.crossingStyle, availableCrossings, DEFAULT_DRAWING_SETTINGS.crossingStyle, 'crossingStyle', issues);
  const startPoint = merged.startPoint?.mode === 'fixed' ? merged.startPoint : { mode: 'auto' as const };

  const style = oneOf(merged.style, DRAWING_STYLES, DEFAULT_DRAWING_SETTINGS.style, 'style', issues);
  const styleProfile = DRAWING_STYLE_PROFILES[style];
  const engine = oneLineEngine(styleProfile.engineId);

  // Detail: the preset, or a continuous value between the presets.
  const profile = DETAIL_PROFILES[detailLevel];
  const detail = requestedDetail ?? profile.detail;
  const customDetail = detail === profile.detail ? null : detail;
  const presetParameters = (level: OneLineDetailLevel) => applyParameterPatches(base, DETAIL_PROFILES[level].parameters);
  const detailParameters = customDetail === null ? presetParameters(detailLevel) : interpolateDetailParameters(detail, presetParameters, isIntegerParameter);
  const styled = applyParameterPatches(
    detailParameters,
    styleProfile.parameters,
    LINE_CHARACTER_PROFILES[lineCharacter] ?? {},
    CROSSING_STYLE_PROFILES[crossingStyle] ?? {},
  );

  // Smoothing: extends the engine's own smoothing (Chaikin passes); only for styles that smooth.
  const requestedSmoothing = optionalValue(merged.smoothing, SMOOTHING_RANGE, true, 'smoothing', issues);
  const smoothing = requestedSmoothing === styled.smoothingIterations ? null : requestedSmoothing;
  const smoothingPatch = smoothing !== null && styleProfile.smoothing ? { smoothingIterations: smoothing } : {};

  const patched = applyParameterPatches(styled, smoothingPatch, merged.overrides ?? {});
  const parameters = sanitizeEngineParameters(patched);
  issues.push(...parameters.issues);

  if (typeof merged.seed !== 'number' || !Number.isFinite(merged.seed)) {
    throw new EngineError('invalid-parameters', `seed must be a finite number (got ${String(merged.seed)})`);
  }
  const settings = sanitizeOneLineSettings({
    seed: merged.seed,
    detail,
    maxPoints,
    ...(startPoint.mode === 'fixed' ? { startPoint: { x: startPoint.x, y: startPoint.y } } : {}),
  });
  issues.push(...settings.issues);

  const drawing: DrawingSettings = {
    style,
    detailLevel,
    detail: customDetail,
    smoothing,
    seed: settings.value.seed,
    lineCharacter,
    crossingStyle,
    startPoint: settings.value.startPoint ? { mode: 'fixed', ...settings.value.startPoint } : startPoint,
    overrides: merged.overrides ?? {},
  };
  const identity = canonical({
    engineId: engine.id,
    engineVersion: engine.version,
    settings: settings.value,
    parameters: parameters.value,
  });
  const key = `${isCustomDrawing(drawing) ? 'custom' : detailLevel}-${hashString(identity).toString(16).padStart(8, '0')}${hashString(`${identity}#`).toString(16).padStart(8, '0')}`;

  return {
    drawing,
    settings: settings.value,
    parameters: parameters.value,
    engineId: engine.id,
    engineVersion: engine.version,
    key,
    issues,
  };
}

/** Effective settings of every detail preset, keeping the other choices (custom values dropped). */
export function resolveAllDetailLevels(drawing: Partial<DrawingSettings> = {}): Readonly<Record<(typeof DETAIL_LEVELS)[number], EffectiveOneLineSettings>> {
  return Object.fromEntries(DETAIL_LEVELS.map((level) => [level, resolveOneLineSettings({ ...drawing, detailLevel: level, detail: null, smoothing: null })])) as Record<
    (typeof DETAIL_LEVELS)[number],
    EffectiveOneLineSettings
  >;
}
