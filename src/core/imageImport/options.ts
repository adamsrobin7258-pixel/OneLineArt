export interface ImageImportOptions {
  /** Files above this size are rejected as unusually large. */
  readonly maxFileBytes: number;
  /** Decoding more pixels than this risks running out of memory on phones. */
  readonly maxPixels: number;
  /** Long edge of the display copy used for the preview incl. zoom. */
  readonly previewMaxEdge: number;
  /**
   * Long edge of the working copy for analysis and path generation.
   * PROVISIONAL: the final value is determined together with the algorithm (part 4/5).
   */
  readonly processingMaxEdge: number;
}

export const DEFAULT_IMPORT_OPTIONS: ImageImportOptions = {
  maxFileBytes: 80 * 1024 * 1024,
  maxPixels: 100_000_000,
  // 4096² is the largest canvas area iOS Safari reliably allows.
  previewMaxEdge: 4096,
  processingMaxEdge: 2048,
};
