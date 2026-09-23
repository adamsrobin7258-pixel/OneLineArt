import type { ExifOrientation, ImageFormat, Size } from '../models';

/** Information read from the file header without decoding pixels. */
export interface ImageHeaderInfo {
  /** Stored (not yet oriented) dimensions, if the header could be read. */
  readonly rawSize: Size | null;
  readonly orientation: ExifOrientation;
}

/** How many leading bytes are enough to find dimensions and EXIF orientation. */
export const HEADER_READ_BYTES = 512 * 1024;

export function readImageHeader(bytes: Uint8Array, format: ImageFormat): ImageHeaderInfo {
  switch (format) {
    case 'jpeg':
      return readJpeg(bytes);
    case 'png':
      return { rawSize: readPngSize(bytes), orientation: 1 };
    case 'webp':
      return { rawSize: readWebpSize(bytes), orientation: 1 };
    default:
      // HEIC/HEIF store orientation in container boxes; the decoder applies it.
      return { rawSize: null, orientation: 1 };
  }
}

function readJpeg(b: Uint8Array): ImageHeaderInfo {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let rawSize: Size | null = null;
  let orientation: ExifOrientation = 1;
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) break;
    const marker = b[o + 1]!;
    if (marker === 0xff) {
      o++; // fill byte
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      o += 2; // markers without length
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const length = view.getUint16(o + 2);
    const segment = o + 4;
    if (marker === 0xe1 && segment + 6 <= b.length && String.fromCharCode(...b.subarray(segment, segment + 6)) === 'Exif\0\0') {
      orientation = readExifOrientation(view, segment + 6) ?? orientation;
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof && segment + 5 <= b.length) {
      rawSize = { height: view.getUint16(segment + 1), width: view.getUint16(segment + 3) };
    }
    o = segment + length - 2;
  }
  return { rawSize, orientation };
}

function readExifOrientation(view: DataView, tiff: number): ExifOrientation | null {
  if (tiff + 8 > view.byteLength) return null;
  const order = view.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const le = order === 0x4949;
  const ifd = tiff + view.getUint32(tiff + 4, le);
  if (ifd + 2 > view.byteLength) return null;
  const entries = view.getUint16(ifd, le);
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > view.byteLength) return null;
    if (view.getUint16(entry, le) === 0x0112) {
      const value = view.getUint16(entry + 8, le);
      return value >= 1 && value <= 8 ? (value as ExifOrientation) : null;
    }
  }
  return null;
}

function readPngSize(b: Uint8Array): Size | null {
  if (b.length < 24) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function readWebpSize(b: Uint8Array): Size | null {
  if (b.length < 30) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const chunk = String.fromCharCode(...b.subarray(12, 16));
  if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    const w = b[24]! | (b[25]! << 8) | (b[26]! << 16);
    const h = b[27]! | (b[28]! << 8) | (b[29]! << 16);
    return { width: w + 1, height: h + 1 };
  }
  return null;
}
