import {
  DEFAULT_ENGINE_PARAMETERS,
  DEFAULT_ONE_LINE_SETTINGS,
  EngineError,
  computePathMetrics,
  createRandom,
  generateOneLine,
  type ImageAnalysis,
  type OneLineDiagnostics,
  type OneLineEngineParameters,
  type OneLinePath,
  type OneLineSettings,
  type PathErrorCode,
  type PathMetrics,
  type ProcessedImage,
} from '../../core';
import type { PathResponse } from './pathProtocol';

export interface PathOutcome {
  readonly path: OneLinePath;
  readonly metrics: PathMetrics;
  readonly diagnostics: OneLineDiagnostics;
  readonly durationMs: number;
  readonly runner: 'worker' | 'main-thread';
  readonly parameters: OneLineEngineParameters;
}

export class PathGenerationError extends Error {
  constructor(
    readonly code: PathErrorCode,
    detail: string,
  ) {
    super(detail);
    this.name = 'PathGenerationError';
  }
}

export interface PathJob {
  readonly promise: Promise<PathOutcome>;
  /** Stops the work; the promise then never settles. */
  readonly cancel: () => void;
}

function createWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./pathGeneration.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

/** Generous safety limit: a normal run takes 1–3 s on desktop. */
export const PATH_TIME_LIMIT_MS = 60_000;

/**
 * Generates the One-Line path in a dedicated worker (terminated on cancel or
 * image change), falling back to the main thread where workers are missing.
 */
export function runPathGeneration(
  processed: ProcessedImage,
  analysis: ImageAnalysis,
  settings: OneLineSettings = DEFAULT_ONE_LINE_SETTINGS,
  parameters: OneLineEngineParameters = DEFAULT_ENGINE_PARAMETERS,
): PathJob {
  const worker = createWorker();
  let cancelled = false;

  if (!worker) {
    const promise = new Promise<PathOutcome>((resolve, reject) => {
      setTimeout(() => {
        if (cancelled) return;
        const started = performance.now();
        try {
          const result = generateOneLine({ image: processed.pixels, analysis, settings }, parameters, {
            rng: createRandom(settings.seed),
            shouldAbort: () => cancelled || performance.now() - started > PATH_TIME_LIMIT_MS,
          });
          resolve({
            path: result.path,
            metrics: computePathMetrics(result.path, { demand: result.demand, importance: analysis.importance }),
            diagnostics: result.diagnostics,
            durationMs: performance.now() - started,
            runner: 'main-thread',
            parameters,
          });
        } catch (error) {
          reject(new PathGenerationError(error instanceof EngineError ? error.code : 'generation-failed', String(error)));
        }
      }, 0);
    });
    return { promise, cancel: () => (cancelled = true) };
  }

  const active = worker;
  const promise = new Promise<PathOutcome>((resolve, reject) => {
    active.addEventListener('message', (event: MessageEvent<PathResponse>) => {
      active.terminate();
      if (cancelled) return;
      const data = event.data;
      if (data.ok) resolve({ path: data.path, metrics: data.metrics, diagnostics: data.diagnostics, durationMs: data.durationMs, runner: 'worker', parameters });
      else reject(new PathGenerationError(data.error, data.detail));
    });
    active.addEventListener('error', (event) => {
      active.terminate();
      if (!cancelled) reject(new PathGenerationError('generation-failed', `Worker error: ${event.message}`));
    });
    try {
      active.postMessage({ processed, analysis, settings, parameters, timeLimitMs: PATH_TIME_LIMIT_MS });
    } catch (error) {
      active.terminate();
      reject(new PathGenerationError('out-of-memory', `Could not send data to worker: ${String(error)}`));
    }
  });
  return {
    promise,
    cancel: () => {
      cancelled = true;
      active.terminate();
    },
  };
}
