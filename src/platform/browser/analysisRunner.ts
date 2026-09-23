import {
  AnalysisError,
  DEFAULT_ANALYSIS_PARAMETERS,
  analysisErrorCode,
  analyzeProcessedImage,
  type AnalysisParameters,
  type ImageAnalysis,
  type ProcessedImage,
} from '../../core';
import type { AnalysisResponse } from './analysisProtocol';

export interface AnalysisOutcome {
  readonly analysis: ImageAnalysis;
  readonly durationMs: number;
  readonly runner: 'worker' | 'main-thread';
}

export interface AnalysisJob {
  readonly promise: Promise<AnalysisOutcome>;
  /** Stops the work; the promise then never settles. */
  readonly cancel: () => void;
}

function createWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

/**
 * Analyses a working copy in a dedicated worker (one per job, so an image
 * change can terminate it immediately). Falls back to the main thread.
 * The pixel buffer is copied into the worker; the session's copy stays intact.
 */
export function runAnalysis(processed: ProcessedImage, parameters: AnalysisParameters = DEFAULT_ANALYSIS_PARAMETERS): AnalysisJob {
  const worker = createWorker();
  let cancelled = false;

  if (!worker) {
    const promise = new Promise<AnalysisOutcome>((resolve, reject) => {
      setTimeout(() => {
        if (cancelled) return;
        const started = performance.now();
        try {
          resolve({ analysis: analyzeProcessedImage(processed, parameters), durationMs: performance.now() - started, runner: 'main-thread' });
        } catch (error) {
          reject(error instanceof AnalysisError ? error : new AnalysisError(analysisErrorCode(error), undefined, { cause: error }));
        }
      }, 0);
    });
    return { promise, cancel: () => (cancelled = true) };
  }

  const promise = new Promise<AnalysisOutcome>((resolve, reject) => {
    worker.addEventListener('message', (event: MessageEvent<AnalysisResponse>) => {
      worker.terminate();
      if (cancelled) return;
      const data = event.data;
      if (data.ok) resolve({ analysis: data.analysis, durationMs: data.durationMs, runner: 'worker' });
      else reject(new AnalysisError(data.error, data.detail));
    });
    worker.addEventListener('error', (event) => {
      worker.terminate();
      if (!cancelled) reject(new AnalysisError('analysis-failed', `Worker error: ${event.message}`));
    });
    try {
      worker.postMessage({ processed, parameters });
    } catch (error) {
      worker.terminate();
      reject(new AnalysisError(analysisErrorCode(error), 'Could not send image to worker', { cause: error }));
    }
  });
  return {
    promise,
    cancel: () => {
      cancelled = true;
      worker.terminate();
    },
  };
}
