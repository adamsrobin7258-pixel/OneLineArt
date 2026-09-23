import type { OneLinePath, OneLineSettings, RasterImage } from '../models';
import type { ImageAnalysis } from '../imageAnalysis';
import type { Random } from '../utils';

export interface PathGenerationInput {
  readonly image: RasterImage;
  readonly analysis: ImageAnalysis;
  readonly settings: OneLineSettings;
}

export interface PathGenerationContext {
  /** The only allowed randomness source. */
  readonly rng: Random;
  /** Progress in [0, 1]; used by the UI via a worker later. */
  readonly onProgress?: (progress: number) => void;
  /**
   * Polled between work units. Returning true aborts with an EngineError
   * ('aborted'); used for time limits and cancellation. Never changes a
   * result — a run either completes deterministically or fails.
   */
  readonly shouldAbort?: () => boolean;
}

/** Computes the single continuous line. */
export interface OneLinePathGenerator {
  readonly id: string;
  /** Bump whenever output for identical input changes. */
  readonly version: string;
  generate(input: PathGenerationInput, context: PathGenerationContext): OneLinePath;
}

/** Post-processing on an existing path (smoothing, simplification, ...). Must keep it one line. */
export interface PathOptimizer {
  readonly id: string;
  optimize(path: OneLinePath, input: PathGenerationInput, rng: Random): OneLinePath;
}
