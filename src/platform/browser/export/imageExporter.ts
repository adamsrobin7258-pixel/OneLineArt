import {
  ExportError,
  IMAGE_FORMAT_INFO,
  exportFileName,
  imageExportSize,
  sanitizeImageExportSettings,
  settingsForOpaqueOutput,
  throwIfCancelled,
  type CancelSignal,
  type ExportFile,
  type ExportPhase,
  type ExportSource,
  type ImageExportSettings,
  type RasterImage,
} from '../../../core';
import { freeSurface, lineColorsFor, renderArtworkSurface } from '../artworkRenderer';
import { canExportInWorker, runImageExportInWorker } from './imageExportRunner';
import { asExportError, encodeSurface, yieldToUi } from './encodeCanvas';

export type BrowserExportSource = ExportSource<RasterImage, CanvasImageSource>;

export interface ImageExportRequest {
  readonly source: BrowserExportSource;
  readonly settings: Partial<ImageExportSettings>;
  readonly signal?: CancelSignal;
  readonly onPhase?: (phase: ExportPhase) => void;
  /** Time used for the file name. */
  readonly date?: Date;
}

export interface ImageExportTimings {
  readonly renderMs: number;
  readonly encodeMs: number;
  readonly totalMs: number;
  /** Where it was rendered: a worker (UI stays responsive) or the main thread (fallback). */
  readonly thread: 'worker' | 'main';
}

/**
 * Still image export: the existing path is rendered anew at the target
 * resolution (never an upscaled preview, never a screenshot) and encoded —
 * in a worker where the browser supports it (cancel terminates it), else on
 * the main thread (the canvas encoder cannot be interrupted there; a cancel
 * during encoding discards its result).
 */
export async function exportArtworkImage(request: ImageExportRequest): Promise<ExportFile<Blob> & { readonly timings: ImageExportTimings }> {
  const started = performance.now();
  const { source, signal, onPhase } = request;
  onPhase?.('preparing');
  const settings = sanitizeImageExportSettings(request.settings);
  const info = IMAGE_FORMAT_INFO[settings.format];
  const { size } = imageExportSize(source.path.bounds, source.originalSize, settings.resolution);
  const render = info.mimeType === 'image/jpeg' ? settingsForOpaqueOutput(source.render) : source.render;
  const fileName = exportFileName({ projectName: source.projectName, date: request.date ?? new Date(), extension: info.extension });

  await yieldToUi();
  throwIfCancelled(signal);
  onPhase?.('rendering');
  const longEdge = Math.max(size.width, size.height);
  const quality = settings.format === 'jpeg' ? settings.jpegQuality : undefined;

  // Off the main thread when possible. The photo background ('original') stays on the main
  // thread: sending it would copy a large bitmap for a developer-only option.
  if (canExportInWorker() && render.background !== 'original') {
    const lineColors = render.colorMode === 'sampled-color' ? lineColorsFor(source.path, source.image, render) : null;
    const done = await runImageExportInWorker(
      { path: source.path, settings: render, longEdge, lineColors, mimeType: info.mimeType, quality },
      { ...(signal ? { signal } : {}), onEncoding: () => onPhase?.('encoding') },
    );
    if (done) {
      throwIfCancelled(signal);
      const { blob } = done;
      if (blob.type !== info.mimeType) throw new ExportError('codec-unsupported', `${info.mimeType} not supported (got ${blob.type})`);
      return { fileName, mimeType: blob.type, sizeBytes: blob.size, data: blob, timings: { renderMs: done.renderMs, encodeMs: done.encodeMs, totalMs: performance.now() - started, thread: 'worker' } };
    }
  }

  await yieldToUi();
  const renderStart = performance.now();
  let rendered;
  try {
    rendered = renderArtworkSurface({ path: source.path, settings: render, longEdge, image: source.image, backgroundImage: source.backgroundImage });
  } catch (error) {
    throw asExportError(error, 'out-of-memory');
  }
  const renderMs = performance.now() - renderStart;
  try {
    throwIfCancelled(signal);
    onPhase?.('encoding');
    await yieldToUi();
    const encodeStart = performance.now();
    const blob = await encodeSurface(rendered.surface, info.mimeType, quality);
    const encodeMs = performance.now() - encodeStart;
    throwIfCancelled(signal);
    return { fileName, mimeType: blob.type, sizeBytes: blob.size, data: blob, timings: { renderMs, encodeMs, totalMs: performance.now() - started, thread: 'main' } };
  } catch (error) {
    throw asExportError(error);
  } finally {
    freeSurface(rendered.surface);
  }
}
