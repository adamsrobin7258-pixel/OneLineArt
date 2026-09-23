export type AnalysisErrorCode =
  /** No image selected. */
  | 'no-image'
  /** Image selected, but its pixel data is not accessible. */
  | 'image-unavailable'
  /** Pixel buffer does not match the declared dimensions. */
  | 'invalid-image'
  /** Dimensions outside what the analysis supports. */
  | 'unexpected-dimensions'
  | 'out-of-memory'
  | 'analysis-failed';

export class AnalysisError extends Error {
  readonly code: AnalysisErrorCode;

  constructor(code: AnalysisErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? code, options);
    this.name = 'AnalysisError';
    this.code = code;
  }
}

export function analysisErrorCode(error: unknown): AnalysisErrorCode {
  if (error instanceof AnalysisError) return error.code;
  if (error instanceof RangeError) return 'out-of-memory';
  return 'analysis-failed';
}
