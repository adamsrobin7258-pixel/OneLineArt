import type { RasterImage } from '../../core';
import type { VariableWidthLine, VariableWidthParameters } from '../../core/experimental/variableWidth';

export interface VariableWidthRequest {
  readonly image: RasterImage;
  readonly parameters: Partial<VariableWidthParameters>;
}

export type VariableWidthResponse =
  | { readonly ok: true; readonly line: VariableWidthLine; readonly durationMs: number }
  | { readonly ok: false; readonly detail: string };
