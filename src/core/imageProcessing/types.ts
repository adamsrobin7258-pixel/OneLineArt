import type { RasterImage } from '../models';

/**
 * Pure pixel transformations (crop, rotate, resize, exposure, ...).
 * The editor in part 2 composes these; they never mutate their input.
 */
export interface ImageOperation {
  readonly kind: string;
  apply(input: RasterImage): RasterImage;
}

export function applyOperations(input: RasterImage, ops: readonly ImageOperation[]): RasterImage {
  return ops.reduce((img, op) => op.apply(img), input);
}
