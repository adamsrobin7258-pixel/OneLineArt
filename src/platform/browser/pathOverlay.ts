import { tracePath, type OneLinePath, type ScalarField } from '../../core';

export type OverlayBackground =
  | { readonly kind: 'image'; readonly source: CanvasImageSource }
  | { readonly kind: 'field'; readonly field: ScalarField }
  | { readonly kind: 'blank' };

/** Overlays are rendered at least this large, so small source images still show a crisp vector line. */
const MIN_OVERLAY_EDGE = 1600;

/**
 * Developer overlay: the path drawn over a background. Rendered at the path's
 * own resolution or larger (lineWidth in overlay pixels). Not the final
 * rendering of part 6.
 */
export async function renderPathOverlay(path: OneLinePath, background: OverlayBackground, color: string, lineWidth: number): Promise<ImageBitmap> {
  const scale = Math.max(1, MIN_OVERLAY_EDGE / Math.max(path.bounds.width, path.bounds.height));
  const width = Math.round(path.bounds.width * scale);
  const height = Math.round(path.bounds.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas allocation failed');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  if (background.kind === 'image') {
    ctx.globalAlpha = 0.45;
    ctx.drawImage(background.source, 0, 0, width, height);
    ctx.globalAlpha = 1;
  } else if (background.kind === 'field') {
    const { field } = background;
    const pixels = new ImageData(field.width, field.height);
    for (let i = 0; i < field.data.length; i++) {
      const v = 255 - Math.round(Math.min(1, Math.max(0, field.data[i]!)) * 200);
      pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = v;
      pixels.data[i * 4 + 3] = 255;
    }
    const layer = await createImageBitmap(pixels);
    ctx.drawImage(layer, 0, 0, width, height);
    layer.close();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth / scale;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.beginPath();
  tracePath(path, ctx);
  ctx.stroke();
  const bitmap = await createImageBitmap(canvas);
  canvas.width = 0;
  canvas.height = 0;
  return bitmap;
}
