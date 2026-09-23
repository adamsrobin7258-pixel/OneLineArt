import type { RasterImage, ScalarField } from '../models';
import type { Random } from '../utils';

/**
 * Result of image analysis: how much each area of the image should attract
 * the line. Values in [0, 1], same grid as the (processed) source image.
 * Additional channels (edges, tone, orientation) are added in part 3.
 */
export interface ImageAnalysis {
  readonly importance: ScalarField;
}

export interface ImageAnalyzer {
  readonly id: string;
  analyze(image: RasterImage, rng: Random): ImageAnalysis;
}
