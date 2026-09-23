import { describe, expect, it } from 'vitest';
import { readImageHeader } from '../../src/core';
import { ftypBytes, jpegBytes, pngBytes, webpVp8xBytes } from '../fixtures/imageBytes';

describe('image header parsing', () => {
  it('reads JPEG dimensions without EXIF (orientation defaults to 1)', () => {
    expect(readImageHeader(jpegBytes({ width: 4032, height: 3024 }), 'jpeg')).toEqual({
      rawSize: { width: 4032, height: 3024 },
      orientation: 1,
    });
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('reads EXIF orientation %i in both byte orders', (orientation) => {
    for (const littleEndian of [false, true]) {
      const info = readImageHeader(jpegBytes({ width: 400, height: 300, orientation, littleEndian }), 'jpeg');
      expect(info.orientation).toBe(orientation);
      expect(info.rawSize).toEqual({ width: 400, height: 300 });
    }
  });

  it('ignores invalid orientation values', () => {
    expect(readImageHeader(jpegBytes({ width: 10, height: 10, orientation: 9 }), 'jpeg').orientation).toBe(1);
  });

  it('survives truncated JPEG headers', () => {
    const bytes = jpegBytes({ width: 10, height: 10, orientation: 6 }).subarray(0, 30);
    expect(() => readImageHeader(bytes, 'jpeg')).not.toThrow();
  });

  it('reads PNG dimensions', () => {
    expect(readImageHeader(pngBytes(1920, 1080), 'png')).toEqual({ rawSize: { width: 1920, height: 1080 }, orientation: 1 });
  });

  it('reads WebP (VP8X) dimensions', () => {
    expect(readImageHeader(webpVp8xBytes(3000, 4000), 'webp').rawSize).toEqual({ width: 3000, height: 4000 });
  });

  it('leaves HEIC dimensions to the decoder', () => {
    expect(readImageHeader(ftypBytes('heic'), 'heic')).toEqual({ rawSize: null, orientation: 1 });
  });
});
