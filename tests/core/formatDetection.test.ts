import { describe, expect, it } from 'vitest';
import { detectFormat } from '../../src/core';
import { ftypBytes, gifBytes, jpegBytes, pngBytes, textBytes, webpVp8xBytes } from '../fixtures/imageBytes';

const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe('format detection (by content, not name)', () => {
  it.each([
    ['JPEG', jpegBytes({ width: 4, height: 3 }), 'jpeg', 'image/jpeg'],
    ['PNG', pngBytes(4, 3), 'png', 'image/png'],
    ['WebP', webpVp8xBytes(4, 3), 'webp', 'image/webp'],
    ['HEIC', ftypBytes('heic', ['mif1', 'heic']), 'heic', 'image/heic'],
    ['HEIF', ftypBytes('mif1', ['mif1']), 'heif', 'image/heif'],
    ['HEIC via compatible brand', ftypBytes('mif1', ['heic']), 'heic', 'image/heic'],
  ])('accepts %s', (_, bytes, format, mimeType) => {
    expect(detectFormat(bytes)).toEqual({ kind: 'supported', format, mimeType });
  });

  it.each([
    ['GIF', gifBytes()],
    ['AVIF', ftypBytes('avif', ['mif1'])],
    ['TIFF', new Uint8Array([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0])],
    ['BMP', new Uint8Array([0x42, 0x4d, 0, 0, 0, 0])],
    ['PDF', ascii('%PDF-1.7')],
    ['SVG', new TextEncoder().encode('\uFEFF  <svg xmlns="http://www.w3.org/2000/svg"></svg>')],
  ])('recognises %s as unsupported', (_, bytes) => {
    expect(detectFormat(bytes).kind).toBe('unsupported');
  });

  it.each([
    ['text', textBytes()],
    ['empty', new Uint8Array()],
    ['random bytes', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])],
  ])('rejects %s as unknown', (_, bytes) => {
    expect(detectFormat(bytes)).toEqual({ kind: 'unknown' });
  });
});
