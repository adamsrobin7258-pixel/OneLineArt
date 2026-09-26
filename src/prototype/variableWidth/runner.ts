import type { RasterImage } from '../../core';
import { generateVariableWidthLine, type VariableWidthLine, type VariableWidthParameters } from '../../core/experimental/variableWidth';
import type { VariableWidthResponse } from './protocol';

export interface VariableWidthOutcome {
  readonly line: VariableWidthLine;
  readonly durationMs: number;
  readonly runner: 'worker' | 'main-thread';
}

export interface VariableWidthJob {
  readonly promise: Promise<VariableWidthOutcome>;
  /** Stops the job; its promise then never settles. */
  readonly cancel: () => void;
}

function createWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./variableWidth.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

/** One worker per job (a newer job cancels the old one); main-thread fallback without workers. */
export function runVariableWidth(image: RasterImage, parameters: Partial<VariableWidthParameters>): VariableWidthJob {
  let cancelled = false;
  const onMainThread = () =>
    new Promise<VariableWidthOutcome>((resolve, reject) => {
      setTimeout(() => {
        if (cancelled) return;
        const started = performance.now();
        try {
          resolve({ line: generateVariableWidthLine(image, parameters), durationMs: performance.now() - started, runner: 'main-thread' });
        } catch (error) {
          reject(error);
        }
      }, 0);
    });

  const worker = createWorker();
  if (!worker) return { promise: onMainThread(), cancel: () => (cancelled = true) };

  const promise = new Promise<VariableWidthOutcome>((resolve, reject) => {
    worker.addEventListener('message', (event: MessageEvent<VariableWidthResponse>) => {
      worker.terminate();
      if (cancelled) return;
      if (event.data.ok) resolve({ line: event.data.line, durationMs: event.data.durationMs, runner: 'worker' });
      else reject(new Error(event.data.detail));
    });
    // A worker that cannot start (e.g. blocked module workers) falls back to the main thread.
    worker.addEventListener('error', () => {
      worker.terminate();
      if (!cancelled) onMainThread().then(resolve, reject);
    });
    worker.postMessage({ image, parameters });
  });
  return {
    promise,
    cancel: () => {
      cancelled = true;
      worker.terminate();
    },
  };
}
