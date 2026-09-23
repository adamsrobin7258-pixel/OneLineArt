import { useCallback, useState } from 'react';
import type { OneLinePath } from '../../core';
import { PREVIEW_RENDER_EDGE, ZOOM_RENDER_EDGE, ZOOM_SHARPEN_SCALE } from './previewConfig';

/**
 * Preview resolution that follows the zoom: once the user zooms in noticeably,
 * the SAME path is rendered again at a higher resolution (only the renderer
 * runs; analysis and path stay untouched). Stays sharp for that path.
 */
export function useZoomResolution(path: OneLinePath | null) {
  const [sharpFor, setSharpFor] = useState<OneLinePath | null>(null);
  const onScaleChange = useCallback(
    (scale: number) => {
      if (path && scale >= ZOOM_SHARPEN_SCALE) setSharpFor(path);
    },
    [path],
  );
  return { longEdge: path && sharpFor === path ? ZOOM_RENDER_EDGE : PREVIEW_RENDER_EDGE, onScaleChange };
}
