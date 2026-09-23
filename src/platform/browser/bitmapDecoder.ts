import {
  DEFAULT_IMPORT_OPTIONS,
  ImageImportError,
  cropPixelRect,
  editedSize,
  fitWithin,
  isIdentityEdit,
  type BinarySource,
  type ImageEdit,
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

export interface EditedImage {
  /** Display copy of the edited image (a NEW bitmap, or the source itself for the identity edit). */
  readonly preview: ImageBitmap;
  /** Working copy for analysis and path generation. */
  readonly pixels: RasterImage;
  /** Working copy px per ORIGINAL px of the edited image (ProcessedImage.scale). */
  readonly scale: number;
}

const QUARTER: Record<ImageEdit['rotation'], { angle: number; tx: (s: Size) => number; ty: (s: Size) => number }> = {
  0: { angle: 0, tx: () => 0, ty: () => 0 },
  90: { angle: Math.PI / 2, tx: (s) => s.height, ty: () => 0 },
  180: { angle: Math.PI, tx: (s) => s.width, ty: (s) => s.height },
  270: { angle: -Math.PI / 2, tx: () => 0, ty: (s) => s.width },
};

/** Working copy from a display copy, sized like the import does (never upscaled). */
function workingCopy(display: ImageBitmap, target: Size): RasterImage {
  const size = target.width > display.width || target.height > display.height ? { width: display.width, height: display.height } : target;
  const canvas = sameSize(display, size) ? null : drawScaled(display, size);
  const pixels = readPixels(canvas ?? display, size);
  if (canvas) freeCanvas(canvas);
  return pixels;
}

/**
 * Applies a non-destructive edit to the (unedited) display copy: rotate by
 * quarter turns and cut out the crop in ONE draw (exact pixel copy, no
 * resampling), then derive the working copy like the import does. Works on
 * the display copy (≤ 4096 px), never on the full original, so no large image
 * is decoded or copied again. The identity edit reproduces the import's
 * working copy bit for bit (same size rule, same scaling steps).
 */
export async function applyImageEdit(
  source: ImageBitmap,
  edit: ImageEdit,
  originalSize: Size,
  processingMaxEdge = DEFAULT_IMPORT_OPTIONS.processingMaxEdge,
): Promise<EditedImage> {
  const target = fitWithin(editedSize(originalSize, edit), processingMaxEdge);
  if (isIdentityEdit(edit)) {
    const pixels = workingCopy(source, target);
    return { preview: source, pixels, scale: pixels.width / originalSize.width };
  }
  const rect = cropPixelRect(source, edit);
  const { canvas, ctx } = createCanvas(rect);
  const q = QUARTER[edit.rotation];
  ctx.translate(-rect.x, -rect.y);
  ctx.translate(q.tx(source), q.ty(source));
  ctx.rotate(q.angle);
  ctx.drawImage(source, 0, 0);
  let preview: ImageBitmap | null = null;
  try {
    preview = await createImageBitmap(canvas);
    freeCanvas(canvas);
    // Keep the edited image's aspect ratio exactly (crop px of the display copy).
    const pixels = workingCopy(preview, fitWithin(rect, Math.max(target.width, target.height)));
    return { preview, pixels, scale: pixels.width / editedSize(originalSize, edit).width };
  } catch (error) {
    freeCanvas(canvas);
    preview?.close();
    throw error;
  }
}
