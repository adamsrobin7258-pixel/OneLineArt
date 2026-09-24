export type AnimationPacing =
  /** Pen moves at constant speed along the line (by arc length). */
  | 'constant-speed'
  /** Every path point takes the same time, regardless of segment length. */
  | 'per-point';

/** How time maps to progress. Only 'linear' is available (even drawing speed); others are prepared. */
export type AnimationEasing = 'linear' | 'ease-in-out';

/** Playback direction along the unchanged path. */
export type AnimationDirection = 'forward' | 'reverse';

/** A point on the (edited) image, normalized 0..1 — independent of any screen size. */
export interface NormalizedPoint {
  readonly x: number;
  readonly y: number;
}

export interface AnimationSettings {
  /** Duration of the complete drawing at 1× speed. */
  readonly durationMs: number;
  /** Speed factor: the line is drawn in durationMs / speed (default 1). */
  readonly speed?: number;
  /** Default 'forward' (the path's own order). */
  readonly direction?: AnimationDirection;
  /**
   * Where the drawing starts, chosen on the edited image (null/absent = the
   * path's own start). Snapped to the nearest point of the path at playback.
   */
  readonly startPoint?: NormalizedPoint | null;
  /**
   * Preview only (phase 13.7): after the final hold the drawing starts again
   * from the start point. Default false; exported videos contain the drawing once.
   */
  readonly loop?: boolean;
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
  speed: 1,
  direction: 'forward',
  startPoint: null,
  loop: false,
};
