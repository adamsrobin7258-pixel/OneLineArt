import { useEffect, useRef } from 'react';
import type { OneLinePath, RenderStyle } from '../../core';
import { drawPathToCanvas } from '../../platform/browser/canvasRenderer';

interface PathPreviewProps {
  path: OneLinePath;
  style: RenderStyle;
  caption?: string;
}

/** Large, calm preview of a path. Pure presentation; rendering lives in core/platform. */
export function PathPreview({ path, style, caption }: PathPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) drawPathToCanvas(canvas, path, style);
  }, [path, style]);

  return (
    <figure className="preview">
      <canvas ref={canvasRef} className="preview__canvas" style={{ aspectRatio: `${path.bounds.width} / ${path.bounds.height}` }} />
      {caption && <figcaption className="preview__caption">{caption}</figcaption>}
    </figure>
  );
}
