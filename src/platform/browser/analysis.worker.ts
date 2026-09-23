import { ANALYSIS_LAYERS, analysisErrorCode, analyzeProcessedImage } from '../../core';
import type { AnalysisRequest, AnalysisResponse } from './analysisProtocol';

/** Runs the pure core analysis off the main thread; layer buffers are transferred, not copied. */
self.addEventListener('message', (event: MessageEvent<AnalysisRequest>) => {
  const started = performance.now();
  let response: AnalysisResponse;
  let transfer: Transferable[] = [];
  try {
    const analysis = analyzeProcessedImage(event.data.processed, event.data.parameters);
    response = { ok: true, analysis, durationMs: performance.now() - started };
    transfer = ANALYSIS_LAYERS.map((name) => analysis[name].data.buffer);
  } catch (error) {
    response = { ok: false, error: analysisErrorCode(error), detail: error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error) };
  }
  (self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage(response, transfer);
});
