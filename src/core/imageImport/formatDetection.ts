import type { ImageFormat } from '../models';

export type DetectedFormat =
  | { readonly kind: 'supported'; readonly format: ImageFormat; readonly mimeType: string }
  /** A recognised image/document format the app does not accept. */
  | { readonly kind: 'unsupported'; readonly name: string }
  /** Not recognisable as an image at all. */
  | { readonly kind: 'unknown' };

const MIME: Record<ImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs']);
const HEIF_BRANDS = new Set(['mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

const ascii = (b: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...b.subarray(start, start + length));

const startsWith = (b: Uint8Array, sig: readonly number[], offset = 0): boolean =>
  b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);

/** Identifies the format from the first bytes of a file (magic numbers). */
export function detectFormat(head: Uint8Array): DetectedFormat {
  const supported = (format: ImageFormat): DetectedFormat => ({ kind: 'supported', format, mimeType: MIME[format] });

  if (startsWith(head, [0xff, 0xd8, 0xff])) return supported('jpeg');
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return supported('png');
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return supported('webp');

  if (head.length >= 16 && ascii(head, 4, 4) === 'ftyp') {
    const boxSize = Math.min(head.length, ((head[0]! << 24) | (head[1]! << 16) | (head[2]! << 8) | head[3]!) >>> 0);
    const brands = [ascii(head, 8, 4)];
    for (let o = 16; o + 4 <= boxSize; o += 4) brands.push(ascii(head, o, 4));
    if (AVIF_BRANDS.has(brands[0]!)) return { kind: 'unsupported', name: 'AVIF' };
    if (brands.some((b) => HEIC_BRANDS.has(b))) return supported('heic');
    if (brands.some((b) => HEIF_BRANDS.has(b))) return supported('heif');
    return { kind: 'unsupported', name: 'ISO-Media' };
  }

  if (ascii(head, 0, 4) === 'GIF8') return { kind: 'unsupported', name: 'GIF' };
  if (startsWith(head, [0x42, 0x4d])) return { kind: 'unsupported', name: 'BMP' };
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) return { kind: 'unsupported', name: 'TIFF' };
  if (ascii(head, 0, 4) === '%PDF') return { kind: 'unsupported', name: 'PDF' };
  const textStart = startsWith(head, [0xef, 0xbb, 0xbf]) ? 3 : 0; // UTF-8 BOM
  if (/^\s*(<\?xml|<svg)/i.test(ascii(head, textStart, Math.min(head.length - textStart, 256)))) return { kind: 'unsupported', name: 'SVG' };
  return { kind: 'unknown' };
}
