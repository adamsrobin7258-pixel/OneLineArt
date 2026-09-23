import type {
  ImageAnalysis,
  OneLineDiagnostics,
  OneLineEngineParameters,
  OneLinePath,
  OneLineSettings,
  PathErrorCode,
  PathMetrics,
  ProcessedImage,
} from '../../core';

export interface PathRequest {
  readonly processed: ProcessedImage;
  readonly analysis: ImageAnalysis;
  readonly settings: OneLineSettings;
  readonly parameters: OneLineEngineParameters;
  /** Engine registry id (the drawing style's engine). */
  readonly engineId: string;
  /** Hard safety limit; exceeding it fails the run (never truncates the result). */
  readonly timeLimitMs: number;
}

export type PathResponse =
  | {
      readonly ok: true;
      readonly path: OneLinePath;
      readonly metrics: PathMetrics;
      readonly diagnostics: OneLineDiagnostics;
      readonly durationMs: number;
    }
  | { readonly ok: false; readonly error: PathErrorCode; readonly detail: string };
