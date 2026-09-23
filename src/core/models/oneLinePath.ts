import type { Size } from './geometry';

/**
 * THE central artefact: one single, continuous, ordered polyline.
 *
 * Points are stored as a flat, interleaved coordinate buffer
 * `[x0, y0, x1, y1, ... xn, yn]` so paths with hundreds of thousands of points
 * stay compact and fast to iterate. Index order == drawing order, which both the
 * final render and the creation animation use.
 */
export interface OneLinePath {
  /** Interleaved x/y coordinates in image pixel space. Length is 2 * pointCount. */
  readonly coords: Float32Array;
  /** Canvas the coordinates refer to (the source image size). */
  readonly bounds: Size;
  /** Provenance, needed to reproduce the path. */
  readonly meta: OneLinePathMeta;
}

export interface OneLinePathMeta {
  readonly generatorId: string;
  readonly generatorVersion: string;
  readonly seed: number;
}
