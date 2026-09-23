import { useEffect, useState } from 'react';
import type { OneLinePath } from '../../core';
import { renderPathOverlay, type OverlayBackground } from '../../platform/browser/pathOverlay';

interface Rendered {
  readonly key: string;
  readonly bitmap: ImageBitmap;
}

/**
 * Renders a path (optionally over a background) to a bitmap for the viewer;
 * frees the bitmap when replaced. Technical preview until the rendering of part 6.
 */
export function usePathBitmap(path: OneLinePath | null, background: OverlayBackground | null, key: string): ImageBitmap | null {
  const [rendered, setRendered] = useState<Rendered | null>(null);

  useEffect(() => {
    if (!path || !background) return;
    let cancelled = false;
    let created: ImageBitmap | null = null;
    const lineWidth = Math.max(1, Math.max(path.bounds.width, path.bounds.height, 1600) / 1400);
    renderPathOverlay(path, background, background.kind === 'blank' ? '#111111' : '#c2185b', lineWidth).then((bitmap) => {
      if (cancelled) return bitmap.close();
      created = bitmap;
      setRendered({ key, bitmap });
    });
    return () => {
      cancelled = true;
      created?.close();
    };
    // `key` identifies path + background; the objects themselves are stable per key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return rendered && rendered.key === key ? rendered.bitmap : null;
}
