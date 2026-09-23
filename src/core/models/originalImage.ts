import type { BinarySource } from './binarySource';
import type { ImageMetadata } from './imageMetadata';

/**
 * The photo exactly as the user selected it. Never modified: the untouched
 * file is kept for later exports and re-processing; decoded pixels live in
 * ProcessedImage.
 */
export interface OriginalImage {
  /** Unique per import. Every derived result references it. */
  readonly id: string;
  readonly fileName: string;
  readonly source: BinarySource;
  readonly metadata: ImageMetadata;
  /** Hash of the file bytes; part of the determinism key. */
  readonly contentHash: string;
}
