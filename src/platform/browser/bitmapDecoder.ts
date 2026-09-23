import {
  ImageImportError,
  type BinarySource,
  type DecodedImage,
  type ImageDecoder,
  type RasterImage,
  type Size,
} from '../../core';

type Canvas = HTMLCanvasElement;

function createCanvas({ width, height }: Size): { canvas: Canvas; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  // A null context on a valid size means the platform refused the allocation.
  if (!ctx) throw new ImageImportError('out-of-memory', 'Canvas allocation failed');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

/** Releases canvas backing memory immediately (important on iOS Safari). */
function freeCanvas(canvas: Canvas): void {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Downscales in steps of at most 2× so large reductions stay sharp and
 * alias-free, keeping only one intermediate canvas alive at a time.
 */
function drawScaled(source: CanvasImageSource & Size, target: Size): Canvas {
  let current: CanvasImageSource & Size = source;
  let currentCanvas: Canvas | null = null;
  let { width, height } = source;
  do {
    width = Math.max(target.width, Math.round(width / 2));
    height = Math.max(target.height, Math.round(height / 2));
    const { canvas, ctx } = createCanvas({ width, height });
    ctx.drawImage(current, 0, 0, width, height);
    if (currentCanvas) freeCanvas(currentCanvas);
    currentCanvas = canvas;
    current = canvas;
  } while (width > target.width || height > target.height);
  return currentCanvas;
}

const sameSize = (a: Size, b: Size): boolean => a.width === b.width && a.height === b.height;

/**
 * Browser implementation of the core decoder: one decode via
 * createImageBitmap (EXIF/HEIF orientation applied by the browser),
 * then preview bitmap + processing pixels derived from it.
 */
export const bitmapDecoder: ImageDecoder<ImageBitmap, ImageBitmap> = {
  async decode(source: BinarySource): Promise<DecodedImage<ImageBitmap>> {
    const bitmap = await createImageBitmap(source as Blob, { imageOrientation: 'from-image' });
    return { width: bitmap.width, height: bitmap.height, handle: bitmap };
  },

  async normalize(decoded, targets) {
    const full = decoded.handle;
    let preview: ImageBitmap | null = null;
    try {
      if (sameSize(decoded, targets.preview)) {
        preview = full;
      } else {
        const canvas = drawScaled(full, targets.preview);
        preview = await createImageBitmap(canvas);
        freeCanvas(canvas);
        full.close();
      }

      const processingCanvas = sameSize(targets.preview, targets.processing) ? null : drawScaled(preview, targets.processing);
      const pixels = readPixels(processingCanvas ?? preview, targets.processing);
      if (processingCanvas) freeCanvas(processingCanvas);
      return { preview, pixels };
    } catch (error) {
      full.close();
      preview?.close();
      throw error;
    }
  },

  discard(decoded) {
    decoded.handle.close();
  },

  releasePreview(preview) {
    preview.close();
  },
};

function readPixels(source: CanvasImageSource, size: Size): RasterImage {
  if (source instanceof HTMLCanvasElement) {
    const ctx = source.getContext('2d');
    if (!ctx) throw new ImageImportError('out-of-memory');
    return { ...size, data: ctx.getImageData(0, 0, size.width, size.height).data };
  }
  const { canvas, ctx } = createCanvas(size);
  ctx.drawImage(source, 0, 0);
  const data = ctx.getImageData(0, 0, size.width, size.height).data;
  freeCanvas(canvas);
  return { ...size, data };
}
