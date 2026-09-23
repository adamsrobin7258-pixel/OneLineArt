export type ImageImportErrorCode =
  /** Empty file or not an image. */
  | 'invalid-file'
  /** Recognised, but not an accepted format (GIF, TIFF, SVG, ...). */
  | 'unsupported-format'
  /** HEIC/HEIF that the current platform cannot decode. */
  | 'heic-unsupported'
  /** Looks like an accepted image but cannot be decoded. */
  | 'corrupt'
  /** The file could not be read (removed, permissions, I/O). */
  | 'read-failed'
  | 'file-too-large'
  | 'dimensions-too-large'
  | 'out-of-memory'
  | 'unknown';

export class ImageImportError extends Error {
  readonly code: ImageImportErrorCode;

  constructor(code: ImageImportErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? code, options);
    this.name = 'ImageImportError';
    this.code = code;
  }
}

export function importErrorCode(error: unknown): ImageImportErrorCode {
  return error instanceof ImageImportError ? error.code : 'unknown';
}

/** Heuristic for allocation failures reported by the platform's decoders. */
export function isOutOfMemoryError(error: unknown): boolean {
  if (error instanceof RangeError) return true;
  const name = (error as { name?: unknown } | null)?.name;
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  return name === 'QuotaExceededError' || /memory|allocation/i.test(message);
}
