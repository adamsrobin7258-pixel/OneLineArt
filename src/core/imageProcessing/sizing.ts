import type { Size } from '../models';

/**
 * Scales `size` so its longer edge is at most `maxLongEdge`, preserving the
 * aspect ratio. Never upscales.
 */
export function fitWithin(size: Size, maxLongEdge: number): Size {
  const longEdge = Math.max(size.width, size.height);
  if (longEdge <= maxLongEdge) return { width: size.width, height: size.height };
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/** Width and height as displayed after applying an EXIF orientation. */
export function orientedSize(raw: Size, orientation: number): Size {
  return orientation >= 5 && orientation <= 8 ? { width: raw.height, height: raw.width } : raw;
}
