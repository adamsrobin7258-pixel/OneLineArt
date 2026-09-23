import type { AnalysisErrorCode, AnalysisParameters, ImageAnalysis, ProcessedImage } from '../../core';

export interface AnalysisRequest {
  readonly processed: ProcessedImage;
  readonly parameters: AnalysisParameters;
}

export type AnalysisResponse =
  | { readonly ok: true; readonly analysis: ImageAnalysis; readonly durationMs: number }
  | { readonly ok: false; readonly error: AnalysisErrorCode; readonly detail: string };
