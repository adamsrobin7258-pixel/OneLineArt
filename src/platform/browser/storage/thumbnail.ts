import { STORAGE_LIMITS, type OneLinePath, type ProjectThumbnail, type RasterImage, type RenderSettings } from '../../../core';
import { freeSurface, renderArtworkSurface } from '../artworkRenderer';

/** Compact formats first; the browser's actual output type is checked. */
const THUMBNAIL_TYPES = ['image/webp', 'image/png'] as const;
const THUMBNAIL_QUALITY = 0.85;

/** Gallery thumbnail rendered from the real artwork (same renderer, small size). */
export async function createThumbnail(params: {
  readonly path: OneLinePath;
  readonly render: RenderSettings;
  readonly image: RasterImage;
  readonly backgroundImage: CanvasImageSource | null;
}): Promise<ProjectThumbnail> {
  const { surface, size } = renderArtworkSurface({ ...params, settings: params.render, longEdge: STORAGE_LIMITS.thumbnailEdge });
  try {
    for (const type of THUMBNAIL_TYPES) {
      const canvas = surface.canvas;
      const blob =
        canvas instanceof OffscreenCanvas
          ? await canvas.convertToBlob({ type, quality: THUMBNAIL_QUALITY })
          : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, THUMBNAIL_QUALITY));
      if (blob && blob.type === type && blob.size > 0) return { data: blob, mimeType: type, width: size.width, height: size.height };
    }
    throw new Error('Thumbnail encoding failed');
  } finally {
    freeSurface(surface);
  }
}
