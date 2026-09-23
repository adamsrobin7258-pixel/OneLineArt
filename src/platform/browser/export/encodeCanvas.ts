import { ExportError } from '../../../core';
import type { Surface } from '../artworkRenderer';

/** Lets the UI paint the current phase before a long synchronous step. */
export const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Canvas allocation/drawing failures are memory problems in practice. */
export function asExportError(error: unknown, fallback: 'out-of-memory' | 'encoding-failed' = 'encoding-failed'): ExportError {
  if (error instanceof ExportError) return error;
  if (error instanceof RangeError || (error instanceof Error && /memory|allocation/i.test(error.message))) {
    return new ExportError('out-of-memory', error.message, { cause: error });
  }
  return new ExportError(fallback, error instanceof Error ? error.message : String(error), { cause: error });
}

/**
 * Encodes a rendered surface to an image file. Browsers silently fall back to
 * PNG for unknown types, so the resulting type is checked: never a file whose
 * content does not match its name.
 */
export async function encodeSurface(surface: Surface, mimeType: string, quality?: number): Promise<Blob> {
  const { canvas } = surface;
  const blob =
    canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob(quality === undefined ? { type: mimeType } : { type: mimeType, quality })
      : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, quality));
  if (!blob || blob.size === 0) throw new ExportError('out-of-memory', 'Encoder returned no data');
  if (blob.type !== mimeType) throw new ExportError('codec-unsupported', `${mimeType} not supported (got ${blob.type})`);
  return blob;
}
