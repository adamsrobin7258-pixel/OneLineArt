/**
 * Parameters of the EXPERIMENTAL variable-width line (Phase 15.1 prototype).
 * Not part of the production engines, the drawing settings or projects.
 *
 * All lengths are in pixels of the WORKING grid: the image scaled to
 * `workingLongEdge` on its long side. The spacing therefore means the same
 * for every input size (a 4 px spacing at 800 px ≙ 200 lines on the long side).
 */

/**
 * How the one line covers the picture. Phase 15.1: meander rows (reference),
 * meander columns, spiral (with frame). Phase 15.2: arc spiral, organic meander,
 * flowing curve (curvedRoutes.ts). Phase 15.3: free orthogonal (orthogonalMaze.ts).
 * Phase 15.4: free orthogonal grown (growing-tree labyrinth, same lattice loop).
 */
export const VARIABLE_WIDTH_ROUTES = ['meander-rows', 'meander-columns', 'spiral', 'arc-spiral', 'organic-meander', 'flow', 'free-orthogonal', 'free-orthogonal-grown'] as const;
export type VariableWidthRoute = (typeof VARIABLE_WIDTH_ROUTES)[number];

/**
 * How far the maximum width may exceed the spacing (Phase 15.2 experiment):
 * safe ≤ 0.9 × spacing (Phase 15.1), controlled ≤ 1.2 ×, free ≤ 2 ×.
 */
export const VARIABLE_WIDTH_MODES = ['safe', 'controlled', 'free'] as const;
export type VariableWidthMode = (typeof VARIABLE_WIDTH_MODES)[number];
export const MAX_WIDTH_SHARES: Readonly<Record<VariableWidthMode, number>> = { safe: 0.9, controlled: 1.2, free: 2 };

/** Lightness → width transfer (see transfer.ts). */
export const VARIABLE_WIDTH_CURVES = ['perceptual', 'linear'] as const;
export type VariableWidthCurve = (typeof VARIABLE_WIDTH_CURVES)[number];

export interface VariableWidthParameters {
  /** Long edge of the working grid in px. */
  readonly workingLongEdge: number;
  /** Constant distance between neighbouring lines (centre to centre), px. */
  readonly spacing: number;
  /** Thinnest line (white paper), px. Never 0: the line stays one visible line. */
  readonly minWidth: number;
  /** Thickest line (black), px; at most MAX_WIDTH_SHARE × spacing so lines never merge. */
  readonly maxWidth: number;
  /** −1 … 1: softer (compresses towards mid-grey) … stronger (S-curve); 0 = neutral. */
  readonly contrast: number;
  /** 0 … 2: noise-gated local contrast boost (unsharp mask); 0 = off. */
  readonly detail: number;
  /** Isotropic smoothing of the tone field, as Gaussian sigma in units of the spacing. */
  readonly smoothing: number;
  /** Where the line begins, normalized 0…1. Meander: the nearest corner; spiral: exactly here. */
  readonly start: { readonly x: number; readonly y: number };
  readonly route: VariableWidthRoute;
  readonly curve: VariableWidthCurve;
  /** Stretch the image's tonal range (0.5 %…99.5 % percentiles) to full black…white. */
  readonly autoLevels: boolean;
  /** Arc spiral: distance of the centre beyond the start corner, in canvas diagonals (0 = at the corner). */
  readonly arcCenter: number;
  /** Organic meander and flowing curve: 0…1 share of the largest allowed bend. */
  readonly bend: number;
  /** How far the maximum width may exceed the spacing (see MAX_WIDTH_SHARES). */
  readonly widthMode: VariableWidthMode;
  /** Free orthogonal: seed of the labyrinth (integer). */
  readonly mazeSeed: number;
  /** Free orthogonal: 0…1 share of the slow direction field (1 = long flowing corridors, 0 = random maze). */
  readonly mazeOrder: number;
  /** Free orthogonal: wavelength of the direction field in canvas long edges. */
  readonly mazeScale: number;
  /** Free orthogonal grown (15.4): 0…1 share of steps that extend the newest corridor (1 = few dead ends). */
  readonly mazeRun: number;
  /** Free orthogonal grown: 0…1 preference for going straight on. */
  readonly mazeStraight: number;
  /** Free orthogonal grown: 0…1 avoidance of ┐└┐└ staircases. */
  readonly mazeStairs: number;
  /** Free orthogonal grown: 0…1 avoidance of hairpins (two turns the same way in a row). */
  readonly mazeHairpins: number;
  /** Free orthogonal grown: 0…1 how strongly run and straight vary over the canvas (wavelength mazeScale). */
  readonly mazeVariation: number;
}

/** Largest width as a share of the spacing in the safe mode: keeps a visible gap between neighbouring lines. */
export const MAX_WIDTH_SHARE = MAX_WIDTH_SHARES.safe;
/** Smallest allowed min width as a share of the spacing (never 0). */
export const MIN_WIDTH_SHARE = 0.02;

export const DEFAULT_VARIABLE_WIDTH_PARAMETERS: VariableWidthParameters = {
  workingLongEdge: 800,
  spacing: 4,
  minWidth: 0.45,
  maxWidth: 3.3,
  contrast: 0,
  detail: 0.6,
  smoothing: 0.35,
  start: { x: 0, y: 0 },
  route: 'meander-rows',
  curve: 'perceptual',
  autoLevels: true,
  arcCenter: 0.3,
  bend: 0.8,
  widthMode: 'safe',
  mazeSeed: 1,
  mazeOrder: 0.8,
  mazeScale: 0.6,
  mazeRun: 0.9,
  mazeStraight: 0.2,
  mazeStairs: 1,
  mazeHairpins: 0.7,
  mazeVariation: 0,
};

export interface NumericLimit {
  readonly min: number;
  readonly max: number;
}

/** Hard limits (memory, runtime on phones, meaningful geometry). */
export const VARIABLE_WIDTH_LIMITS = {
  workingLongEdge: { min: 32, max: 2048 },
  spacing: { min: 1.5, max: 40 },
  minWidth: { min: 0.02, max: 36 },
  maxWidth: { min: 0.05, max: 36 },
  contrast: { min: -1, max: 1 },
  detail: { min: 0, max: 2 },
  smoothing: { min: 0, max: 2 },
  arcCenter: { min: 0, max: 3 },
  bend: { min: 0, max: 1 },
  mazeSeed: { min: 0, max: 99999 },
  mazeOrder: { min: 0, max: 1 },
  mazeScale: { min: 0.1, max: 3 },
  mazeRun: { min: 0, max: 1 },
  mazeStraight: { min: 0, max: 1 },
  mazeStairs: { min: 0, max: 1 },
  mazeHairpins: { min: 0, max: 1 },
  mazeVariation: { min: 0, max: 1 },
} as const satisfies Record<string, NumericLimit>;

export interface VariableWidthIssue {
  readonly name: string;
  readonly message: string;
}

const clampTo = (v: number, { min, max }: NumericLimit) => Math.min(max, Math.max(min, v));

/**
 * Fills in defaults, clamps every value into its limits and keeps
 * minWidth < maxWidth ≤ MAX_WIDTH_SHARE × spacing. Every adjustment is reported.
 * Non-finite numbers fall back to the default (reported as well).
 */
export function sanitizeVariableWidthParameters(input: Partial<VariableWidthParameters> = {}): {
  value: VariableWidthParameters;
  issues: VariableWidthIssue[];
} {
  const issues: VariableWidthIssue[] = [];
  const d = DEFAULT_VARIABLE_WIDTH_PARAMETERS;
  const num = (name: keyof typeof VARIABLE_WIDTH_LIMITS): number => {
    const raw = input[name];
    const fallback = d[name];
    if (raw === undefined) return fallback;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      issues.push({ name, message: `${name} must be a finite number; using ${fallback}` });
      return fallback;
    }
    const clamped = clampTo(raw, VARIABLE_WIDTH_LIMITS[name]);
    if (clamped !== raw) issues.push({ name, message: `${name} ${raw} clamped to ${clamped}` });
    return clamped;
  };

  const widthMode = input.widthMode ?? d.widthMode;
  if (!(VARIABLE_WIDTH_MODES as readonly string[]).includes(widthMode)) throw new RangeError(`Unknown width mode "${String(widthMode)}"`);
  const workingLongEdge = Math.round(num('workingLongEdge'));
  const spacing = num('spacing');
  let maxWidth = num('maxWidth');
  let minWidth = num('minWidth');
  const share = MAX_WIDTH_SHARES[widthMode];
  const widest = share * spacing;
  if (maxWidth > widest) {
    issues.push({ name: 'maxWidth', message: `maxWidth ${maxWidth} limited to ${widest.toFixed(3)} (${share} × spacing, mode ${widthMode})` });
    maxWidth = widest;
  }
  const thinnest = MIN_WIDTH_SHARE * spacing;
  if (minWidth < thinnest) {
    issues.push({ name: 'minWidth', message: `minWidth ${minWidth} raised to ${thinnest.toFixed(3)} (never 0)` });
    minWidth = thinnest;
  }
  if (minWidth >= maxWidth) {
    const lowered = Math.max(thinnest, maxWidth * 0.5);
    issues.push({ name: 'minWidth', message: `minWidth ${minWidth} must be below maxWidth ${maxWidth}; using ${lowered.toFixed(3)}` });
    minWidth = lowered;
  }

  const start = input.start ?? d.start;
  const unit = (v: unknown, name: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      issues.push({ name, message: `${name} must be a finite number; using 0` });
      return 0;
    }
    return Math.min(1, Math.max(0, v));
  };
  const route = input.route ?? d.route;
  const curve = input.curve ?? d.curve;
  if (!(VARIABLE_WIDTH_ROUTES as readonly string[]).includes(route)) throw new RangeError(`Unknown route "${String(route)}"`);
  if (!(VARIABLE_WIDTH_CURVES as readonly string[]).includes(curve)) throw new RangeError(`Unknown curve "${String(curve)}"`);

  return {
    value: {
      workingLongEdge,
      spacing,
      minWidth,
      maxWidth,
      contrast: num('contrast'),
      detail: num('detail'),
      smoothing: num('smoothing'),
      start: { x: unit(start.x, 'start.x'), y: unit(start.y, 'start.y') },
      route,
      curve,
      autoLevels: input.autoLevels ?? d.autoLevels,
      arcCenter: num('arcCenter'),
      bend: num('bend'),
      widthMode,
      mazeSeed: Math.round(num('mazeSeed')),
      mazeOrder: num('mazeOrder'),
      mazeScale: num('mazeScale'),
      mazeRun: num('mazeRun'),
      mazeStraight: num('mazeStraight'),
      mazeStairs: num('mazeStairs'),
      mazeHairpins: num('mazeHairpins'),
      mazeVariation: num('mazeVariation'),
    },
    issues,
  };
}
