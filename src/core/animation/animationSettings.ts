import { DEFAULT_ANIMATION_SETTINGS, type AnimationEasing, type AnimationPacing, type AnimationSettings } from '../models';

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

/** Playback speeds (prepared; independent of the drawing's duration). */
export const SPEED_PRESETS = [0.5, 1, 2, 4] as const;

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
    },
    issues,
  };
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
