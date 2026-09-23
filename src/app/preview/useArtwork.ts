import { useEffect, useState } from 'react';
import type { OneLinePath, RasterArtwork, RasterImage, RenderSettings } from '../../core';
import { renderArtwork } from '../../platform/browser/artworkRenderer';

interface Rendered {
  readonly key: string;
  readonly artwork: RasterArtwork<ImageBitmap>;
}

export interface ArtworkRequest {
  readonly path: OneLinePath | null;
  readonly settings: RenderSettings;
  readonly longEdge: number;
  readonly image: RasterImage;
  readonly backgroundImage?: CanvasImageSource | null;
}

const pathIds = new WeakMap<OneLinePath, number>();
let nextPathId = 0;
const idOf = (path: OneLinePath) => {
  let id = pathIds.get(path);
  if (id === undefined) pathIds.set(path, (id = ++nextPathId));
  return id;
};

/**
 * Renders the artwork for a path + render settings. Render-only changes
 * (black ↔ colour, background) re-draw the SAME path; the previous bitmap
 * stays visible until the new one is ready, then it is released.
 */
export function useArtwork({ path, settings, longEdge, image, backgroundImage }: ArtworkRequest): { artwork: RasterArtwork<ImageBitmap> | null; error: unknown } {
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [error, setError] = useState<unknown>(null);
  const key = path ? `${idOf(path)}|${longEdge}|${JSON.stringify(settings)}` : '';

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    renderArtwork({ path, settings, longEdge, image, backgroundImage: backgroundImage ?? null }).then(
      (artwork) => {
        if (cancelled) return artwork.image.close();
        setError(null);
        setRendered((previous) => {
          previous?.artwork.image.close();
          return { key, artwork };
        });
      },
      (e: unknown) => {
        if (!cancelled) {
          console.error('Rendering failed', e);
          setError(e);
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // `key` captures path identity and all settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Release the last bitmap when the component goes away.
  useEffect(() => () => setRendered((previous) => (previous?.artwork.image.close(), null)), []);

  return { artwork: path ? (rendered?.artwork ?? null) : null, error };
}
