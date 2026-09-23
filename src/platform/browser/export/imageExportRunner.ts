import { ExportError, type CancelSignal } from '../../../core';
import type { ImageExportJob, ImageExportMessage } from './imageExportProtocol';

/** Rendering + encoding in a worker needs a 2D OffscreenCanvas with convertToBlob. */
export function canExportInWorker(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof OffscreenCanvas.prototype.convertToBlob === 'function';
}

/** Resolves null if the worker cannot do the job here (caller falls back to the main thread). */
export function runImageExportInWorker(
  job: ImageExportJob,
  opts: { readonly signal?: CancelSignal & Partial<Pick<AbortSignal, 'addEventListener' | 'removeEventListener'>>; readonly onEncoding?: () => void },
): Promise<{ blob: Blob; renderMs: number; encodeMs: number } | null> {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./imageExport.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const signal = opts.signal;
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener?.('abort', onAbort);
    };
    // Cancelling really stops the work: the worker is terminated.
    const onAbort = () => {
      finish();
      reject(new ExportError('cancelled'));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener?.('abort', onAbort);
    worker.onmessage = (event: MessageEvent<ImageExportMessage>) => {
      const message = event.data;
      if (message.type === 'phase') return opts.onEncoding?.();
      finish();
      if (message.type === 'done') resolve({ blob: message.blob, renderMs: message.renderMs, encodeMs: message.encodeMs });
      else if (message.code === 'unsupported') resolve(null);
      else reject(new ExportError(message.code, message.message));
    };
    // Script could not be loaded / started: not an export error, just no worker here.
    worker.onerror = (event) => {
      event.preventDefault();
      finish();
      resolve(null);
    };
    worker.postMessage(job);
  });
}
