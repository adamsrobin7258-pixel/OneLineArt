import type { RasterImage } from './raster';

/** The photo as imported by the user, decoded to pixels. */
export interface OriginalImage {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  /** Decoded pixels. Width/height live on the raster. */
  readonly pixels: RasterImage;
  /** Content hash of the pixels; part of the determinism key. */
  readonly contentHash: string;
}
