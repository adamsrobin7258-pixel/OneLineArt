import type { Size } from '../models';
import { renderSize } from '../rendering/renderer';
import { ExportError } from './errors';
import { EXPORT_LIMITS, type ImageResolution, type VideoResolution } from './exportSettings';

export interface ExportSize {
  /** Final pixel size; always the artwork's exact aspect ratio (renderer rounding only). */
  readonly size: Size;
  /** Long edge that was asked for. */
  readonly requestedLongEdge: number;
  /** True if the safety limits reduced the size (only possible for "original size"). */
  readonly limited: boolean;
}

/** Video frame: short edge of "1080p" and the box it has to fit in. */
const HD = { short: 1080, long: 1920 } as const;
/** How far below the target edge to look for an even frame size (codecs need even dimensions). */
const EVEN_SIZE_SEARCH = 64;

function checkSize(name: string, size: Size): void {
  if (!(Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0)) {
    throw new ExportError('invalid-settings', `${name} ${size.width}×${size.height} is not a valid size`);
  }
}

/** Largest long edge whose render size stays within `maxPixels` (and `maxEdge`). */
function limitLongEdge(bounds: Size, longEdge: number, maxEdge: number, maxPixels: number): number {
  const ratio = Math.max(bounds.width, bounds.height) / Math.min(bounds.width, bounds.height);
  let edge = Math.min(Math.round(longEdge), maxEdge, Math.floor(Math.sqrt(maxPixels * ratio)));
  const area = (e: number) => {
    const s = renderSize(bounds, e);
    return s.width * s.height;
  };
  while (edge > 1 && area(edge) > maxPixels) edge--;
  return edge;
}

/**
 * Pixel size of an image export. The size is the LONG edge; the aspect ratio
 * comes from the artwork (= the photo). "Original" uses the original photo's
 * long edge and is reduced to the safety limits if necessary (`limited`).
 */
export function imageExportSize(bounds: Size, original: Size, resolution: ImageResolution): ExportSize {
  checkSize('Artwork', bounds);
  checkSize('Original', original);
  const requested = resolution === 'original' ? Math.max(original.width, original.height) : Number(resolution);
  const edge = limitLongEdge(bounds, requested, EXPORT_LIMITS.imageEdge, EXPORT_LIMITS.imagePixels);
  return { size: renderSize(bounds, edge), requestedLongEdge: requested, limited: edge < requested };
}

/**
 * Frame size of a video export: aspect ratio preserved, both edges even
 * (required by H.264/VP9 encoders). The long edge is at most the requested
 * one; the nearest smaller edge with an even render size is used.
 */
export function videoFrameSize(bounds: Size, resolution: VideoResolution): ExportSize {
  checkSize('Artwork', bounds);
  const long = Math.max(bounds.width, bounds.height);
  const short = Math.min(bounds.width, bounds.height);
  const requested = resolution === '1080p' ? Math.min(HD.long, Math.floor((HD.short * long) / short)) : Number(resolution);
  const edge = limitLongEdge(bounds, requested, EXPORT_LIMITS.videoEdge, EXPORT_LIMITS.videoPixels);
  for (let e = edge; e > Math.max(1, edge - EVEN_SIZE_SEARCH); e--) {
    const size = renderSize(bounds, e);
    if (size.width % 2 === 0 && size.height % 2 === 0) return { size, requestedLongEdge: requested, limited: edge < requested };
  }
  throw new ExportError('size-unsupported', `No even video size near ${edge} px for ${bounds.width}×${bounds.height}`);
}
