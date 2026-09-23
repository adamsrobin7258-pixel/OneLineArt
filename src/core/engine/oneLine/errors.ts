export type EngineErrorCode =
  /** The analysis is missing layers or has inconsistent sizes. */
  | 'invalid-analysis'
  /** Aborted via shouldAbort (time limit or cancellation). */
  | 'aborted'
  /** The generated path failed validation (should never happen). */
  | 'invalid-result';

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'EngineError';
    this.code = code;
  }
}
