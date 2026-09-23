import type { RasterImage } from './raster';

/**
 * Normalized working copy of an OriginalImage: upright, sRGB RGBA,
 * aspect ratio preserved, scaled to the processing resolution.
 * Colors are kept; no grayscale or color reduction happens here.
 */
export interface ProcessedImage {
  readonly sourceImageId: string;
  readonly pixels: RasterImage;
  /** processed size / original size (<= 1, no upscaling). */
  readonly scale: number;
}
