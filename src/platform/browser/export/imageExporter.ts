import {
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
import { freeSurface, renderArtworkSurface } from '../artworkRenderer';
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
}

/**
 * Still image export: the existing path is rendered anew at the target
 * resolution (never an upscaled preview, never a screenshot) and encoded.
 * The canvas encoder cannot be interrupted; a cancel during encoding
 * discards its result.
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
  await yieldToUi();
  const renderStart = performance.now();
  let rendered;
  try {
    rendered = renderArtworkSurface({ path: source.path, settings: render, longEdge: Math.max(size.width, size.height), image: source.image, backgroundImage: source.backgroundImage });
  } catch (error) {
    throw asExportError(error, 'out-of-memory');
  }
  const renderMs = performance.now() - renderStart;
  try {
    throwIfCancelled(signal);
    onPhase?.('encoding');
    await yieldToUi();
    const encodeStart = performance.now();
    const blob = await encodeSurface(rendered.surface, info.mimeType, settings.format === 'jpeg' ? settings.jpegQuality : undefined);
    const encodeMs = performance.now() - encodeStart;
    throwIfCancelled(signal);
    return { fileName, mimeType: blob.type, sizeBytes: blob.size, data: blob, timings: { renderMs, encodeMs, totalMs: performance.now() - started } };
  } catch (error) {
    throw asExportError(error);
  } finally {
    freeSurface(rendered.surface);
  }
}
