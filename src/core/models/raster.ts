import type { Size } from './geometry';

/**
 * Platform-independent RGBA pixel buffer (8 bit per channel, row-major).
 * Deliberately not the DOM `ImageData`, so the core runs in Node, workers and tests.
 */
export interface RasterImage extends Size {
  readonly data: Uint8ClampedArray;
}

/** Single-channel float image, e.g. luminance or an importance map. */
export interface ScalarField extends Size {
  readonly data: Float32Array;
}
