import { useEffect, useState } from 'react';
import { fieldToRgba, type DebugColormap, type ScalarField } from '../../core';

interface Rendered {
  readonly field: ScalarField;
  readonly colormap: DebugColormap;
  readonly bitmap: ImageBitmap;
}

/** Renders a [0,1] field to an ImageBitmap for the viewer; frees it when no longer shown. */
export function useFieldBitmap(field: ScalarField | null, colormap: DebugColormap): ImageBitmap | null {
  const [rendered, setRendered] = useState<Rendered | null>(null);

  useEffect(() => {
    if (!field) return;
    let cancelled = false;
    let created: ImageBitmap | null = null;
    const pixels = new ImageData(new Uint8ClampedArray(fieldToRgba(field, colormap)), field.width, field.height);
    createImageBitmap(pixels).then((bitmap) => {
      if (cancelled) return bitmap.close();
      created = bitmap;
      setRendered({ field, colormap, bitmap });
    });
    return () => {
      cancelled = true;
      created?.close();
    };
  }, [field, colormap]);

  return rendered && rendered.field === field && rendered.colormap === colormap ? rendered.bitmap : null;
}
