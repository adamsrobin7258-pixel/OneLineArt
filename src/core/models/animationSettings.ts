export type AnimationPacing =
  /** Pen moves at constant speed along the line (by arc length). */
  | 'constant-speed'
  /** Every path point takes the same time, regardless of segment length. */
  | 'per-point';

/** How time maps to progress. Only 'linear' is available (even drawing speed); others are prepared. */
export type AnimationEasing = 'linear' | 'ease-in-out';

export interface AnimationSettings {
  /** Duration of the complete drawing at 1× speed. */
  readonly durationMs: number;
  /** Frame rate for rendered videos (the live preview is time-based and ignores it). */
  readonly fps: number;
  readonly pacing: AnimationPacing;
  /** Default 'linear' (even drawing speed along the path). */
  readonly easing?: AnimationEasing;
}

export const DEFAULT_ANIMATION_SETTINGS: AnimationSettings = {
  durationMs: 10_000,
  fps: 30,
  pacing: 'constant-speed',
  easing: 'linear',
};
