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
}

export const DEFAULT_ONE_LINE_SETTINGS: OneLineSettings = {
  seed: 1,
  detail: 0.5,
  maxPoints: 200_000,
};
