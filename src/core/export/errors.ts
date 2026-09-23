export type ExportErrorCode =
  /** Settings outside the allowed values (NaN, unknown format …). */
  | 'invalid-settings'
  /** Requested size is above the safety limits or cannot be allocated. */
  | 'size-unsupported'
  | 'out-of-memory'
  /** The platform has no usable encoding API at all (e.g. no WebCodecs). */
  | 'encoder-unavailable'
  /** An encoding API exists, but none of its codecs supports this size/frame rate. */
  | 'codec-unsupported'
  | 'encoding-failed'
  /** Project without drawing or with inconsistent data. */
  | 'invalid-project'
  /** The finished file could not be saved or handed to the share sheet. */
  | 'save-failed'
  | 'cancelled';

export class ExportError extends Error {
  constructor(
    readonly code: ExportErrorCode,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? code, options);
    this.name = 'ExportError';
  }
}

export const exportErrorCode = (error: unknown): ExportErrorCode => (error instanceof ExportError ? error.code : 'encoding-failed');

/** Minimal cancellation contract; a browser AbortSignal satisfies it structurally. */
export interface CancelSignal {
  readonly aborted: boolean;
}

export function throwIfCancelled(signal: CancelSignal | undefined): void {
  if (signal?.aborted) throw new ExportError('cancelled');
}
