/** Formats the app accepts. Detected from file content, not from name or MIME type. */
export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'heic' | 'heif';

/** EXIF orientation (1 = upright). 5–8 swap width and height. */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface ImageMetadata {
  readonly format: ImageFormat;
  readonly mimeType: string;
  readonly fileSizeBytes: number;
  /** Upright dimensions, i.e. after applying the orientation. */
  readonly width: number;
  readonly height: number;
  /** width / height of the upright image. */
  readonly aspectRatio: number;
  /** Orientation stored in the file; already applied to all decoded pixels. */
  readonly orientation: ExifOrientation;
}
