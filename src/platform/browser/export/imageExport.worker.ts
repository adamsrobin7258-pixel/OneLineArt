/// <reference lib="webworker" />
import { freeSurface, renderArtworkSurface } from '../artworkRenderer';
import { asExportError, encodeSurface } from './encodeCanvas';
import type { ImageExportJob, ImageExportMessage } from './imageExportProtocol';

/**
 * Image export off the main thread: the SAME renderer draws the existing path
 * onto an OffscreenCanvas, which is encoded here; only the finished file goes
 * back. The main thread stays responsive, and cancelling terminates the worker.
 */
const post = (message: ImageExportMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);

self.onmessage = async (event: MessageEvent<ImageExportJob>) => {
  const job = event.data;
  if (typeof OffscreenCanvas === 'undefined' || !new OffscreenCanvas(1, 1).getContext('2d')) {
    post({ type: 'error', code: 'unsupported', message: 'No 2D OffscreenCanvas in workers' });
    return;
  }
  let rendered;
  const renderStart = performance.now();
  try {
    rendered = renderArtworkSurface({ path: job.path, settings: job.settings, longEdge: job.longEdge, lineColors: job.lineColors });
  } catch (error) {
    const e = asExportError(error, 'out-of-memory');
    post({ type: 'error', code: e.code, message: e.message });
    return;
  }
  const renderMs = performance.now() - renderStart;
  try {
    post({ type: 'phase', phase: 'encoding', renderMs });
    const encodeStart = performance.now();
    const blob = await encodeSurface(rendered.surface, job.mimeType, job.quality);
    post({ type: 'done', blob, renderMs, encodeMs: performance.now() - encodeStart });
  } catch (error) {
    const e = asExportError(error);
    post({ type: 'error', code: e.code, message: e.message });
  } finally {
    freeSurface(rendered.surface);
  }
};
