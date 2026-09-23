import { EngineError, computePathMetrics, createRandom, oneLineEngine, type PathErrorCode } from '../../core';
import type { PathRequest, PathResponse } from './pathProtocol';

/** Runs the pure One-Line engine (of the requested style) off the main thread and measures the result. */
self.addEventListener('message', (event: MessageEvent<PathRequest>) => {
  const { processed, analysis, settings, parameters, engineId, timeLimitMs } = event.data;
  const started = performance.now();
  let response: PathResponse;
  let transfer: Transferable[] = [];
  try {
    const result = oneLineEngine(engineId).run({ image: processed.pixels, analysis, settings }, parameters, {
      rng: createRandom(settings.seed),
      shouldAbort: () => performance.now() - started > timeLimitMs,
    });
    const durationMs = performance.now() - started;
    const metrics = computePathMetrics(result.path, { demand: result.demand, importance: analysis.importance });
    response = { ok: true, path: result.path, metrics, diagnostics: result.diagnostics, durationMs };
    transfer = [result.path.coords.buffer];
  } catch (error) {
    const code: PathErrorCode = error instanceof EngineError ? error.code : error instanceof RangeError ? 'out-of-memory' : 'generation-failed';
    response = { ok: false, error: code, detail: error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error) };
  }
  (self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage(response, transfer);
});
