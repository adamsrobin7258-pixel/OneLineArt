import { DEFAULT_ANIMATION_SETTINGS, type AnimationDirection, type AnimationEasing, type AnimationPacing, type AnimationSettings, type NormalizedPoint } from '../models';

/** Durations offered to the user (ms). */
export const DURATION_PRESETS_MS = [5_000, 10_000, 15_000, 30_000] as const;
/**
 * How long the finished artwork stays visible after the line is complete —
 * in the preview and in exported videos (single definition). The drawing
 * itself still takes exactly the chosen duration; this only extends the
 * playback/video timeline: 10 s drawing + 2 s hold = 12 s video.
 */
export const FINAL_HOLD_MS = 2_000;

/** Total playback / video length for a drawing duration (drawing + final hold). */
export const timelineDurationMs = (drawDurationMs: number, holdMs: number = FINAL_HOLD_MS): number => drawDurationMs + holdMs;

/**
 * Own drawing durations (ms): 2 s … 60 s in 0.5 s steps. With the slowest
 * speed the drawing lasts at most 120 s (+ hold) — ≈ 3700 video frames at 30 fps.
 */
export const DURATION_RANGE_MS = { min: 2_000, max: 60_000, step: 500 } as const;

/** Speed factors offered to the user: the drawing takes durationMs / speed. */
export const SPEED_PRESETS = [0.5, 1, 2, 4] as const;

export const ANIMATION_DIRECTIONS: readonly AnimationDirection[] = ['forward', 'reverse'];

/** True for one of the preset durations (anything else is an own/custom value). */
export const isPresetDuration = (durationMs: number): boolean => (DURATION_PRESETS_MS as readonly number[]).includes(durationMs);

/**
 * The time the line is actually drawn: durationMs / speed. Time-based and
 * deterministic (no frame rate involved); the final hold comes on top.
 */
export const drawingDurationMs = (settings: Pick<AnimationSettings, 'durationMs' | 'speed'>): number => settings.durationMs / (settings.speed ?? 1);

export const ANIMATION_EASINGS: readonly AnimationEasing[] = ['linear', 'ease-in-out'];
/** Easings that may be selected. 'ease-in-out' is prepared but would distort the perceived drawing speed. */
export const AVAILABLE_EASINGS: readonly AnimationEasing[] = ['linear'];
const PACINGS: readonly AnimationPacing[] = ['constant-speed', 'per-point'];

export const ANIMATION_LIMITS = {
  durationMs: { min: 500, max: 600_000 },
  fps: { min: 1, max: 120 },
  speed: { min: 0.1, max: 16 },
} as const;

export class AnimationError extends Error {
  readonly code: 'invalid-settings' | 'invalid-path' | 'invalid-progress';

  constructor(code: AnimationError['code'], message: string) {
    super(message);
    this.name = 'AnimationError';
    this.code = code;
  }
}

export interface AnimationSettingsIssue {
  readonly name: string;
  readonly value: unknown;
  readonly message: string;
}

function finite(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new AnimationError('invalid-settings', `${name} must be a finite number (got ${String(value)})`);
  return value;
}

/** Central validation: non-finite → AnimationError; out of range → clamped; unknown modes → default. */
export function sanitizeAnimationSettings(input: Partial<AnimationSettings> = {}): { value: Required<AnimationSettings>; issues: AnimationSettingsIssue[] } {
  const issues: AnimationSettingsIssue[] = [];
  const s = { ...DEFAULT_ANIMATION_SETTINGS, ...input };
  const clampTo = (name: string, value: unknown, range: { min: number; max: number }, integer = false) => {
    const raw = finite(name, value);
    const v = Math.min(range.max, Math.max(range.min, integer ? Math.round(raw) : raw));
    if (v !== raw) issues.push({ name, value, message: `${name} adjusted to ${v}` });
    return v;
  };
  const pick = <T extends string>(name: string, value: unknown, allowed: readonly T[], fallback: T): T => {
    if ((allowed as readonly unknown[]).includes(value)) return value as T;
    issues.push({ name, value, message: `${name} "${String(value)}" not available; using "${fallback}"` });
    return fallback;
  };
  return {
    value: {
      durationMs: clampTo('durationMs', s.durationMs, ANIMATION_LIMITS.durationMs),
      fps: clampTo('fps', s.fps, ANIMATION_LIMITS.fps, true),
      pacing: pick('pacing', s.pacing, PACINGS, DEFAULT_ANIMATION_SETTINGS.pacing),
      easing: pick<AnimationEasing>('easing', s.easing ?? 'linear', AVAILABLE_EASINGS, 'linear'),
      speed: clampTo('speed', s.speed ?? 1, ANIMATION_LIMITS.speed),
      direction: pick<AnimationDirection>('direction', s.direction ?? 'forward', ANIMATION_DIRECTIONS, 'forward'),
      startPoint: startPointOf(s.startPoint ?? null, issues),
      loop: loopOf(s.loop, issues),
    },
    issues,
  };
}

function loopOf(value: unknown, issues: AnimationSettingsIssue[]): boolean {
  if (value === undefined || typeof value === 'boolean') return value === true;
  issues.push({ name: 'loop', value, message: 'loop must be true or false; using false' });
  return false;
}

function startPointOf(value: unknown, issues: AnimationSettingsIssue[]): NormalizedPoint | null {
  if (value === null) return null;
  const p = value as { x?: unknown; y?: unknown };
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!ok(p?.x) || !ok(p?.y)) throw new AnimationError('invalid-settings', `startPoint must have finite x and y (got ${JSON.stringify(value)})`);
  const point = { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) };
  if (point.x !== p.x || point.y !== p.y) issues.push({ name: 'startPoint', value, message: 'startPoint clamped to the image' });
  return point;
}

/** A user-chosen duration: within DURATION_RANGE_MS, on its 0.5 s grid. */
export function clampDurationMs(durationMs: number): number {
  const { min, max, step } = DURATION_RANGE_MS;
  return Math.min(max, Math.max(min, Math.round(finite('durationMs', durationMs) / step) * step));
}

/** Easing curve t ∈ [0,1] → [0,1]. */
export function applyEasing(easing: AnimationEasing, t: number): number {
  switch (easing) {
    case 'linear':
      return t;
    case 'ease-in-out':
      return t * t * (3 - 2 * t);
  }
}

/**
 * Time → progress. Purely time-based (elapsed / duration), independent of
 * frame rate, dropped frames or video fps. Clamped to [0, 1].
 */
export function progressAtTime(elapsedMs: number, settings: AnimationSettings): number {
  const t = finite('elapsedMs', elapsedMs) / settings.durationMs;
  return applyEasing(settings.easing ?? 'linear', Math.min(1, Math.max(0, t)));
}

/** Presentation times (ms) of the frames of a rendered video: 0, 1/fps, …, duration (last frame = complete). */
export function frameTimesMs(settings: AnimationSettings): number[] {
  const frames = Math.max(1, Math.round((settings.durationMs / 1000) * settings.fps));
  return Array.from({ length: frames + 1 }, (_, i) => Math.min(settings.durationMs, (i * 1000) / settings.fps));
}
