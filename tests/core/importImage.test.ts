import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_IMPORT_OPTIONS,
  ImageImportError,
  importImage,
  type DecodedImage,
  type ImageDecoder,
  type ImageImportErrorCode,
  type ImportPhase,
  type Size,
} from '../../src/core';
import { blobOf, ftypBytes, gifBytes, jpegBytes, pngBytes, textBytes } from '../fixtures/imageBytes';

interface FakeHandle {
  released: boolean;
}

/**
 * Stands in for the browser decoder: "decodes" to the given upright size and
 * produces solid pixels at the requested processing size.
 */
function fakeDecoder(upright: Size | ((format: string) => Size) | Error) {
  const handles: FakeHandle[] = [];
  const previews: { size: Size; released: boolean }[] = [];
  const decoder: ImageDecoder<FakeHandle, { size: Size; released: boolean }> = {
    async decode(_source, format) {
      if (upright instanceof Error) throw upright;
      const size = typeof upright === 'function' ? upright(format) : upright;
      const handle = { released: false };
      handles.push(handle);
      return { ...size, handle };
    },
    async normalize(decoded: DecodedImage<FakeHandle>, targets) {
      decoded.handle.released = true;
      const preview = { size: targets.preview, released: false };
      previews.push(preview);
      const { width, height } = targets.processing;
      return { preview, pixels: { width, height, data: new Uint8ClampedArray(width * height * 4).fill(200) } };
    },
    discard: (decoded) => {
      decoded.handle.released = true;
    },
    releasePreview: (preview) => {
      preview.released = true;
    },
  };
  return { decoder, handles, previews };
}

let nextId = 0;
const createId = () => `img-${++nextId}`;

async function expectError(promise: Promise<unknown>, code: ImageImportErrorCode) {
  await expect(promise).rejects.toBeInstanceOf(ImageImportError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe('importImage', () => {
  it('imports a normal JPG: metadata, untouched original, processing copy', async () => {
    const bytes = jpegBytes({ width: 4032, height: 3024 });
    const file = blobOf(bytes, 'photo.jpg', 'image/jpeg');
    const { decoder } = fakeDecoder({ width: 4032, height: 3024 });

    const result = await importImage(file, { decoder, createId });

    expect(result.original.source).toBe(file); // same object, not a copy
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes); // unchanged
    expect(result.original.fileName).toBe('photo.jpg');
    expect(result.original.metadata).toEqual({
      format: 'jpeg',
      mimeType: 'image/jpeg',
      fileSizeBytes: bytes.length,
      width: 4032,
      height: 3024,
      aspectRatio: 4032 / 3024,
      orientation: 1,
    });
    expect(result.processed.sourceImageId).toBe(result.original.id);
    expect(result.processed.pixels.width).toBe(2048);
    expect(result.processed.pixels.height).toBe(1536);
    expect(result.processed.scale).toBeCloseTo(2048 / 4032);
    expect(result.preview.size).toEqual({ width: 4032, height: 3024 }); // below preview limit: full size
  });

  it('imports a PNG', async () => {
    const { decoder } = fakeDecoder({ width: 800, height: 600 });
    const result = await importImage(blobOf(pngBytes(800, 600), 'a.png'), { decoder, createId });
    expect(result.original.metadata.format).toBe('png');
    expect(result.processed.pixels).toMatchObject({ width: 800, height: 600 }); // no upscaling
    expect(result.processed.scale).toBe(1);
  });

  it('detects the format from content even with a wrong extension and no MIME type', async () => {
    const { decoder } = fakeDecoder({ width: 10, height: 10 });
    const result = await importImage(blobOf(pngBytes(10, 10), 'misnamed.jpg'), { decoder, createId });
    expect(result.original.metadata).toMatchObject({ format: 'png', mimeType: 'image/png' });
  });

  it('handles a very large image (48 MP): full-res metadata, bounded preview and processing sizes', async () => {
    const { decoder, handles } = fakeDecoder({ width: 8000, height: 6000 });
    const result = await importImage(blobOf(jpegBytes({ width: 8000, height: 6000 }), 'big.jpg'), { decoder, createId });
    expect(result.original.metadata).toMatchObject({ width: 8000, height: 6000 });
    expect(result.preview.size).toEqual({ width: DEFAULT_IMPORT_OPTIONS.previewMaxEdge, height: 3072 });
    expect(result.processed.pixels).toMatchObject({ width: 2048, height: 1536 });
    expect(handles.every((h) => h.released)).toBe(true); // full-res decode freed
  });

  it.each([
    ['portrait 3:4', 3024, 4032],
    ['landscape 16:9', 3840, 2160],
    ['portrait 9:16', 2160, 3840],
    ['square 1:1', 3000, 3000],
  ])('preserves the aspect ratio of a %s image', async (_, width, height) => {
    const { decoder } = fakeDecoder({ width, height });
    const result = await importImage(blobOf(jpegBytes({ width, height }), 'x.jpg'), { decoder, createId });
    const { pixels } = result.processed;
    expect(result.original.metadata.aspectRatio).toBe(width / height);
    expect(Math.sign(pixels.width - pixels.height)).toBe(Math.sign(width - height));
    expect(Math.abs(pixels.width / pixels.height / (width / height) - 1)).toBeLessThan(0.001);
  });

  it('handles an EXIF-rotated photo: upright dimensions, orientation recorded', async () => {
    // Sensor stored 4032×3024 landscape, EXIF 6 = rotate 90° clockwise to display.
    const { decoder } = fakeDecoder({ width: 3024, height: 4032 }); // browser applies orientation
    const result = await importImage(blobOf(jpegBytes({ width: 4032, height: 3024, orientation: 6 }), 'rotated.jpg'), {
      decoder,
      createId,
    });
    expect(result.original.metadata).toMatchObject({ width: 3024, height: 4032, orientation: 6, aspectRatio: 3024 / 4032 });
    expect(result.processed.pixels).toMatchObject({ width: 1536, height: 2048 });
  });

  it('reports the phases in order', async () => {
    const phases: ImportPhase[] = [];
    const { decoder } = fakeDecoder({ width: 10, height: 10 });
    await importImage(blobOf(pngBytes(10, 10), 'a.png'), { decoder, createId, onPhase: (p) => phases.push(p) });
    expect(phases).toEqual(['loading', 'processing']);
  });

  it('produces the same content hash for the same bytes', async () => {
    const { decoder } = fakeDecoder({ width: 10, height: 10 });
    const bytes = pngBytes(10, 10);
    const a = await importImage(blobOf(bytes, 'a.png'), { decoder, createId });
    const b = await importImage(blobOf(bytes, 'b.png'), { decoder, createId });
    const c = await importImage(blobOf(pngBytes(10, 11), 'c.png'), { decoder, createId });
    expect(a.original.contentHash).toBe(b.original.contentHash);
    expect(a.original.contentHash).not.toBe(c.original.contentHash);
    expect(a.original.id).not.toBe(b.original.id); // every import is its own image
  });

  describe('errors', () => {
    const decoder = fakeDecoder({ width: 10, height: 10 }).decoder;

    it('rejects an empty file', () => expectError(importImage(blobOf(new Uint8Array(), 'e.jpg'), { decoder, createId }), 'invalid-file'));

    it('rejects a non-image file', () => expectError(importImage(blobOf(textBytes(), 'notes.jpg'), { decoder, createId }), 'invalid-file'));

    it('rejects unsupported formats', () => expectError(importImage(blobOf(gifBytes(), 'a.gif'), { decoder, createId }), 'unsupported-format'));

    it('rejects unusually large files before reading them', () =>
      expectError(
        importImage(blobOf(jpegBytes({ width: 10, height: 10, padding: 2000 }), 'huge.jpg'), {
          decoder,
          createId,
          options: { ...DEFAULT_IMPORT_OPTIONS, maxFileBytes: 1000 },
        }),
        'file-too-large',
      ));

    it('rejects oversized dimensions from the header without decoding', async () => {
      const spy = vi.fn();
      await expectError(
        importImage(blobOf(pngBytes(30000, 30000), 'giant.png'), { decoder: { ...decoder, decode: spy }, createId }),
        'dimensions-too-large',
      );
      expect(spy).not.toHaveBeenCalled();
    });

    it('rejects oversized dimensions discovered after decoding and frees the decode', async () => {
      const { decoder: big, handles } = fakeDecoder({ width: 20000, height: 20000 });
      await expectError(importImage(blobOf(ftypBytes('heic'), 'a.heic'), { decoder: big, createId }), 'dimensions-too-large');
      expect(handles[0]?.released).toBe(true);
    });

    it('reports a damaged JPEG as corrupt', () =>
      expectError(
        importImage(blobOf(jpegBytes({ width: 10, height: 10 }), 'broken.jpg'), {
          decoder: fakeDecoder(new DOMException('The source image cannot be decoded.', 'InvalidStateError')).decoder,
          createId,
        }),
        'corrupt',
      ));

    it('reports HEIC that the platform cannot decode', () =>
      expectError(
        importImage(blobOf(ftypBytes('heic', ['mif1']), 'IMG_0001.HEIC'), {
          decoder: fakeDecoder(new DOMException('Unsupported', 'InvalidStateError')).decoder,
          createId,
        }),
        'heic-unsupported',
      ));

    it('reports memory problems', () =>
      expectError(
        importImage(blobOf(jpegBytes({ width: 10, height: 10 }), 'a.jpg'), {
          decoder: fakeDecoder(new RangeError('Array buffer allocation failed')).decoder,
          createId,
        }),
        'out-of-memory',
      ));

    it('reports unreadable files', () =>
      expectError(
        importImage(
          { name: 'gone.jpg', size: 100, type: '', slice: () => ({ arrayBuffer: () => Promise.reject(new DOMException('', 'NotReadableError')) }) },
          { decoder, createId },
        ),
        'read-failed',
      ));
  });
});
