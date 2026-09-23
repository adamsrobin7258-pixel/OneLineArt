import type { ExportErrorCode, LineColors, OneLinePath, RenderSettings } from '../../../core';

/** Everything the worker needs; the working image stays on the main thread (colours are pre-sampled). */
export interface ImageExportJob {
  readonly path: OneLinePath;
  readonly settings: RenderSettings;
  readonly longEdge: number;
  readonly lineColors: LineColors | null;
  readonly mimeType: string;
  readonly quality: number | undefined;
}

export type ImageExportMessage =
  | { readonly type: 'phase'; readonly phase: 'encoding'; readonly renderMs: number }
  | { readonly type: 'done'; readonly blob: Blob; readonly renderMs: number; readonly encodeMs: number }
  /** 'unsupported': this browser cannot render in a worker (e.g. no 2D OffscreenCanvas) → main thread. */
  | { readonly type: 'error'; readonly code: ExportErrorCode | 'unsupported'; readonly message: string };
