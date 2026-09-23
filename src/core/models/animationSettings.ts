export type AnimationPacing =
  /** Pen moves at constant speed along the line (by arc length). */
  | 'constant-speed'
  /** Every path point takes the same time, regardless of segment length. */
  | 'per-point';

export interface AnimationSettings {
  readonly durationMs: number;
  readonly fps: number;
  readonly pacing: AnimationPacing;
}

export const DEFAULT_ANIMATION_SETTINGS: AnimationSettings = {
  durationMs: 12_000,
  fps: 30,
  pacing: 'constant-speed',
};
