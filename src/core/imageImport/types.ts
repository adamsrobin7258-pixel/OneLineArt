import type { OriginalImage } from '../models';

/**
 * Turns a user-provided source (File, URL, camera, ...) into an OriginalImage.
 * Implemented per platform in src/platform (part 2).
 */
export interface ImageImporter<TSource> {
  import(source: TSource): Promise<OriginalImage>;
}
