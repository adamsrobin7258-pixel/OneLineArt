import { ANIMATION_DIRECTIONS, SPEED_PRESETS, clampDurationMs, isPresetDuration } from '../animation/animationSettings';
import { DETAIL_LEVELS, DRAWING_STYLES, DEFAULT_DRAWING_SETTINGS, type DrawingSettings, type DrawingStyle, type OneLineDetailLevel } from '../drawing';
import { DEFAULT_ANIMATION_SETTINGS, type AnimationDirection, type AnimationSettings } from '../models';
import { RENDER_CONTROLS, backgroundColorPatch } from '../rendering/renderControls';
import { DEFAULT_RENDER_SETTINGS, sanitizeRenderSettings, type RenderSettings } from '../rendering/renderSettings';

export const DEFAULT_BACKGROUNDS = ['white', 'black'] as const;
export type DefaultBackground = (typeof DEFAULT_BACKGROUNDS)[number];

/**
 * Starting values for NEW works (phase 13.8). Never applied to a stored
 * project: opening a work always uses its own saved values.
 */
export interface WorkDefaults {
  readonly style: DrawingStyle;
  readonly detailLevel: OneLineDetailLevel;
  readonly background: DefaultBackground;
  /** Line width in px at the reference edge (as in RenderSettings). */
  readonly lineWidth: number;
  /** Drawing duration at 1× speed. */
  readonly durationMs: number;
  readonly speed: number;
  readonly direction: AnimationDirection;
  readonly loop: boolean;
}

/** The app's own starting values (what a new work got before 13.8). */
export const FACTORY_WORK_DEFAULTS: WorkDefaults = {
  style: DEFAULT_DRAWING_SETTINGS.style,
  detailLevel: DEFAULT_DRAWING_SETTINGS.detailLevel,
  background: 'white',
  lineWidth: DEFAULT_RENDER_SETTINGS.lineWidth,
  durationMs: DEFAULT_ANIMATION_SETTINGS.durationMs,
  speed: DEFAULT_ANIMATION_SETTINGS.speed ?? 1,
  direction: DEFAULT_ANIMATION_SETTINGS.direction ?? 'forward',
  loop: DEFAULT_ANIMATION_SETTINGS.loop ?? false,
};

const oneOf = <T>(value: unknown, allowed: readonly T[], fallback: T): T => ((allowed as readonly unknown[]).includes(value) ? (value as T) : fallback);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Stored defaults read back safely: every missing, unknown or out-of-range
 * value falls back to (or is clamped into) the allowed choices — never an error.
 */
export function parseWorkDefaults(raw: unknown): WorkDefaults {
  const v = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const f = FACTORY_WORK_DEFAULTS;
  const { min, max, step } = RENDER_CONTROLS.lineWidth;
  const duration = finite(v.durationMs) ? (isPresetDuration(v.durationMs) ? v.durationMs : clampDurationMs(v.durationMs)) : f.durationMs;
  return {
    style: oneOf(v.style, DRAWING_STYLES, f.style),
    detailLevel: oneOf(v.detailLevel, DETAIL_LEVELS, f.detailLevel),
    background: oneOf(v.background, DEFAULT_BACKGROUNDS, f.background),
    // On the slider grid, without float noise (e.g. 1.2, never 1.2000000000000002).
    lineWidth: finite(v.lineWidth) ? Number(Math.min(max, Math.max(min, Math.round(v.lineWidth / step) * step)).toFixed(2)) : f.lineWidth,
    // Presets as they are, own values on the 0.5 s grid within 2–60 s.
    durationMs: duration,
    speed: oneOf(v.speed, SPEED_PRESETS as readonly number[], f.speed),
    direction: oneOf(v.direction, ANIMATION_DIRECTIONS, f.direction),
    loop: typeof v.loop === 'boolean' ? v.loop : f.loop,
  };
}

/** Drawing choices of a new work (style + detail preset; everything else as the app defaults). */
export const drawingForNewWork = (d: WorkDefaults): DrawingSettings => ({ ...DEFAULT_DRAWING_SETTINGS, style: d.style, detailLevel: d.detailLevel });

/** Render settings of a new work: the app defaults with the chosen background and line width. */
export function renderForNewWork(d: WorkDefaults): RenderSettings {
  const background = backgroundColorPatch(d.background === 'black' ? '#000000' : '#ffffff', DEFAULT_RENDER_SETTINGS);
  return sanitizeRenderSettings({ ...DEFAULT_RENDER_SETTINGS, ...background, lineWidth: d.lineWidth }).value;
}

/** Animation choices of a new work (no start point: it belongs to an image). */
export const animationForNewWork = (d: WorkDefaults): Pick<AnimationSettings, 'durationMs' | 'speed' | 'direction' | 'startPoint' | 'loop'> => ({
  durationMs: d.durationMs,
  speed: d.speed,
  direction: d.direction,
  startPoint: null,
  loop: d.loop,
});
