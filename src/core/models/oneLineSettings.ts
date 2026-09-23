/**
 * Parameters that fully determine path generation.
 * Same image + same settings + same algorithm version => same path.
 * Detail parameters are fleshed out in part 5.
 */
export interface OneLineSettings {
  /** Seed for all randomness in the pipeline. */
  readonly seed: number;
  /** 0 (sparse) .. 1 (dense). */
  readonly detail: number;
  /** Hard upper bound for the number of path points. */
  readonly maxPoints: number;
  /**
   * Where the line starts, normalized to [0, 1] on both axes (0,0 = top-left).
   * Omitted = automatic (most relevant area).
   */
  readonly startPoint?: { readonly x: number; readonly y: number };
}

export const DEFAULT_ONE_LINE_SETTINGS: OneLineSettings = {
  seed: 1,
  detail: 0.5,
  maxPoints: 200_000,
};
