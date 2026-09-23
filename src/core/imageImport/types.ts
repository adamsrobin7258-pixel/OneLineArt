import type { BinarySource, ImageFormat, OriginalImage, ProcessedImage, RasterImage, Size } from '../models';

/** Result of a successful import: untouched original + normalized working copy + display handle. */
export interface ImportedImage<TPreview> {
  readonly original: OriginalImage;
  readonly processed: ProcessedImage;
  /** Platform-specific, display-optimized version (e.g. an ImageBitmap). */
  readonly preview: TPreview;
}

export interface DecodedImage<THandle> {
  /** Upright dimensions (orientation applied by the decoder). */
  readonly width: number;
  readonly height: number;
  readonly handle: THandle;
}

export interface NormalizeTargets {
  readonly preview: Size;
  readonly processing: Size;
}

/**
 * Platform adapter for pixel work. Implementations decode ONCE, apply the
 * orientation, and derive preview + processing pixels from that single decode.
 */
export interface ImageDecoder<THandle, TPreview> {
  decode(source: BinarySource, format: ImageFormat): Promise<DecodedImage<THandle>>;
  /** Takes ownership of `decoded` and releases it when done. */
  normalize(decoded: DecodedImage<THandle>, targets: NormalizeTargets): Promise<{ preview: TPreview; pixels: RasterImage }>;
  /** Frees a decoded image that will not be normalized (error paths). */
  discard(decoded: DecodedImage<THandle>): void;
  /** Frees a preview when its image is replaced or removed. */
  releasePreview(preview: TPreview): void;
}
