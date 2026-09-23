import { isHexColor } from './colorSpace';
import { COLOR_PALETTES, GRADIENT_STOPS } from './lineColoring';

/** Bump whenever the rendered pixels for identical input change. */
export const RENDERER_VERSION = '1.0.0';

/**
 * Line widths are specified in pixels at this long edge and scaled with the
 * actual render size, so a 1000 px and a 4000 px rendering look the same.
 */
export const REFERENCE_RENDER_EDGE = 1000;

/**
 * How the line is coloured.
 * - monochrome:    one colour (`lineColor`, default black)
 * - sampled-color: colour derived from the photo along the line
 * - custom-color:  PREPARED (not needed: monochrome takes any `lineColor`)
 * - gradient:      colour ramp along the line (`gradient.colors`, start → end)
 * The ONE colour intensity (`sampling.strength`) scales the chroma in every mode.
 */
export const RENDER_COLOR_MODES = ['monochrome', 'sampled-color', 'custom-color', 'gradient'] as const;
export type RenderColorMode = (typeof RENDER_COLOR_MODES)[number];
export const AVAILABLE_RENDER_COLOR_MODES: readonly RenderColorMode[] = ['monochrome', 'sampled-color', 'gradient'];

/**
 * What lies behind the line. 'original' is meant for preview/development;
 * the artwork itself is a standalone drawing on 'white' by default.
 */
export const RENDER_BACKGROUND_MODES = ['white', 'black', 'original', 'transparent', 'custom'] as const;
export type RenderBackgroundMode = (typeof RENDER_BACKGROUND_MODES)[number];

/** Colour sampling along the line (sampled-color mode). Sizes are fractions of the image long edge. */
export interface ColorSamplingSettings {
  /** Distance between sampling stations along the path. */
  readonly stationSpacing: number;
  /** Radius of the local neighbourhood averaged per station. */
  readonly sampleRadius: number;
  /** Share of extreme samples dropped per channel on each side (robust mean). */
  readonly outlierTrim: number;
  /** Gaussian smoothing of the colour flow along the path (sigma, as arc length). */
  readonly smoothing: number;
  /** How much of the photo's chroma is kept (0 = neutral grey line, 1 = full). */
  readonly strength: number;
  /** Allowed OKLab lightness of the line on light backgrounds (keeps it readable on white). */
  readonly lightLightness: { readonly min: number; readonly max: number };
  /** Allowed OKLab lightness on dark backgrounds. */
  readonly darkLightness: { readonly min: number; readonly max: number };
}

/** Colour ramp along the line (evenly spaced stops; a palette or start + end colour). */
export interface GradientSettings {
  readonly colors: readonly string[];
}

export interface RenderSettings {
  readonly colorMode: RenderColorMode;
  /** Line colour for monochrome (and later custom-color). */
  readonly lineColor: string;
  /** Line width in px at REFERENCE_RENDER_EDGE. */
  readonly lineWidth: number;
  /** 0..1, applied once to the whole line (never per segment). */
  readonly lineOpacity: number;
  readonly background: RenderBackgroundMode;
  /** Used for background 'custom'. */
  readonly backgroundColor: string;
  /**
   * The chosen background colour before the lightness slider (white for all
   * projects older than phase 12.2): backgroundColor = colorAtLightness(base, l).
   */
  readonly backgroundBase: string;
  readonly gradient: GradientSettings;
  /** Colour sampling; `strength` is the colour intensity of ALL colour modes. */
  readonly sampling: ColorSamplingSettings;
}

export const DEFAULT_COLOR_SAMPLING: ColorSamplingSettings = {
  stationSpacing: 0.0015,
  sampleRadius: 0.004,
  outlierTrim: 0.2,
  smoothing: 0.012,
  strength: 1,
  lightLightness: { min: 0.2, max: 0.55 },
  darkLightness: { min: 0.62, max: 0.95 },
};

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  colorMode: 'monochrome',
  lineColor: '#000000',
  lineWidth: 1,
  lineOpacity: 1,
  background: 'white',
  backgroundColor: '#ffffff',
  backgroundBase: '#ffffff',
  gradient: { colors: COLOR_PALETTES[0]!.colors },
  sampling: DEFAULT_COLOR_SAMPLING,
};

export interface NumericRange {
  readonly min: number;
  readonly max: number;
}

/** Safety/quality limits for all numeric render settings (single definition). */
export const RENDER_LIMITS = {
  lineWidth: { min: 0.05, max: 20 },
  lineOpacity: { min: 0, max: 1 },
  stationSpacing: { min: 0.0002, max: 0.02 },
  sampleRadius: { min: 0, max: 0.05 },
  outlierTrim: { min: 0, max: 0.45 },
  smoothing: { min: 0, max: 0.1 },
  strength: { min: 0, max: 1.5 },
  lightness: { min: 0, max: 1 },
  /** Largest render edge in px (memory guard for phones). */
  renderEdge: { min: 1, max: 8192 },
} as const satisfies Record<string, NumericRange>;

export class RenderError extends Error {
  readonly code: 'invalid-settings' | 'invalid-input';

  constructor(code: 'invalid-settings' | 'invalid-input', message: string) {
    super(message);
    this.name = 'RenderError';
    this.code = code;
  }
}

export interface RenderSettingsIssue {
  readonly name: string;
  readonly value: unknown;
  readonly message: string;
}

function num(name: string, value: unknown, range: NumericRange, issues: RenderSettingsIssue[]): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RenderError('invalid-settings', `${name} must be a finite number (got ${String(value)})`);
  const v = Math.min(range.max, Math.max(range.min, value));
  if (v !== value) issues.push({ name, value, message: `${name} clamped to ${v}` });
  return v;
}

function oneOf<T extends string>(name: string, value: unknown, allowed: readonly T[], fallback: T, issues: RenderSettingsIssue[]): T {
  if ((allowed as readonly unknown[]).includes(value)) return value as T;
  issues.push({ name, value, message: `${name} "${String(value)}" not available; using "${fallback}"` });
  return fallback;
}

function color(name: string, value: unknown, fallback: string, issues: RenderSettingsIssue[]): string {
  if (isHexColor(value)) return value.toLowerCase();
  issues.push({ name, value, message: `${name} "${String(value)}" is not a #rgb/#rrggbb colour; using ${fallback}` });
  return fallback;
}

function gradient(value: unknown, fallback: GradientSettings, issues: RenderSettingsIssue[]): GradientSettings {
  const colors = (value as { colors?: unknown } | undefined)?.colors;
  if (Array.isArray(colors) && colors.length >= GRADIENT_STOPS.min && colors.length <= GRADIENT_STOPS.max && colors.every(isHexColor)) {
    return { colors: colors.map((c) => c.toLowerCase()) };
  }
  issues.push({ name: 'gradient', value, message: `gradient needs ${GRADIENT_STOPS.min}…${GRADIENT_STOPS.max} #rgb/#rrggbb colours; using the default` });
  return fallback;
}

function lightness(name: string, value: { min: unknown; max: unknown } | undefined, fallback: NumericRange, issues: RenderSettingsIssue[]): NumericRange {
  const min = num(`${name}.min`, value?.min ?? fallback.min, RENDER_LIMITS.lightness, issues);
  const max = num(`${name}.max`, value?.max ?? fallback.max, RENDER_LIMITS.lightness, issues);
  if (min > max) {
    issues.push({ name, value, message: `${name}.min > max: swapped` });
    return { min: max, max: min };
  }
  return { min, max };
}

/**
 * Central validation: non-finite numbers throw; ranges are clamped; unknown
 * modes and invalid colours fall back to defaults. Adjustments are reported.
 */
export function sanitizeRenderSettings(input: Partial<RenderSettings> = {}): { value: RenderSettings; issues: RenderSettingsIssue[] } {
  const issues: RenderSettingsIssue[] = [];
  const d = DEFAULT_RENDER_SETTINGS;
  const s = { ...d, ...input, sampling: { ...d.sampling, ...(input.sampling ?? {}) } };
  const value: RenderSettings = {
    colorMode: oneOf('colorMode', s.colorMode, AVAILABLE_RENDER_COLOR_MODES, d.colorMode, issues),
    lineColor: color('lineColor', s.lineColor, d.lineColor, issues),
    lineWidth: num('lineWidth', s.lineWidth, RENDER_LIMITS.lineWidth, issues),
    lineOpacity: num('lineOpacity', s.lineOpacity, RENDER_LIMITS.lineOpacity, issues),
    background: oneOf('background', s.background, RENDER_BACKGROUND_MODES, d.background, issues),
    backgroundColor: color('backgroundColor', s.backgroundColor, d.backgroundColor, issues),
    backgroundBase: color('backgroundBase', s.backgroundBase, d.backgroundBase, issues),
    gradient: gradient(s.gradient, d.gradient, issues),
    sampling: {
      stationSpacing: num('sampling.stationSpacing', s.sampling.stationSpacing, RENDER_LIMITS.stationSpacing, issues),
      sampleRadius: num('sampling.sampleRadius', s.sampling.sampleRadius, RENDER_LIMITS.sampleRadius, issues),
      outlierTrim: num('sampling.outlierTrim', s.sampling.outlierTrim, RENDER_LIMITS.outlierTrim, issues),
      smoothing: num('sampling.smoothing', s.sampling.smoothing, RENDER_LIMITS.smoothing, issues),
      strength: num('sampling.strength', s.sampling.strength, RENDER_LIMITS.strength, issues),
      lightLightness: lightness('sampling.lightLightness', s.sampling.lightLightness, d.sampling.lightLightness, issues),
      darkLightness: lightness('sampling.darkLightness', s.sampling.darkLightness, d.sampling.darkLightness, issues),
    },
  };
  return { value, issues };
}

/** Whether the line sits on a dark backdrop (affects the colour lightness range). */
export function isDarkBackground(settings: RenderSettings): boolean {
  if (settings.background === 'black') return true;
  if (settings.background !== 'custom') return false;
  const hex = settings.backgroundColor.slice(1);
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 0.4;
}
