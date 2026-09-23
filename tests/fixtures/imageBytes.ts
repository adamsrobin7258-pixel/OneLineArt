/** Byte-level builders for image file headers (no pixel encoder needed). */

const u16be = (v: number) => [(v >> 8) & 0xff, v & 0xff];
const u16le = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u32be = (v: number) => [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
const u32le = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** EXIF APP1 segment containing only the orientation tag. */
export function exifApp1(orientation: number, littleEndian = false): number[] {
  const u16 = littleEndian ? u16le : u16be;
  const u32 = littleEndian ? u32le : u32be;
  const tiff = [
    ...(littleEndian ? ascii('II') : ascii('MM')),
    ...u16(42),
    ...u32(8), // IFD0 offset
    ...u16(1), // one entry
    ...u16(0x0112), // Orientation
    ...u16(3), // SHORT
    ...u32(1),
    ...u16(orientation),
    0,
    0,
    ...u32(0), // no next IFD
  ];
  const payload = [...ascii('Exif'), 0, 0, ...tiff];
  return [0xff, 0xe1, ...u16be(payload.length + 2), ...payload];
}

export interface JpegOptions {
  width: number;
  height: number;
  orientation?: number;
  littleEndian?: boolean;
  /** Extra filler bytes after the header (simulates scan data). */
  padding?: number;
}

/** A JPEG header: SOI, optional EXIF, APP0-like filler, SOF0, SOS. Enough for header parsing. */
export function jpegBytes({ width, height, orientation, littleEndian, padding = 16 }: JpegOptions): Uint8Array {
  const app0 = [0xff, 0xe0, ...u16be(16), ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof0 = [0xff, 0xc0, ...u16be(17), 8, ...u16be(height), ...u16be(width), 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, ...u16be(12), 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0];
  return new Uint8Array([
    0xff,
    0xd8,
    ...app0,
    ...(orientation ? exifApp1(orientation, littleEndian) : []),
    ...sof0,
    ...sos,
    ...new Array(padding).fill(0x55),
    0xff,
    0xd9,
  ]);
}

export function pngBytes(width: number, height: number): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32be(13), ...ascii('IHDR'), ...u32be(width), ...u32be(height), 8, 6, 0, 0, 0, 0, 0, 0, 0]);
}

export function webpVp8xBytes(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return new Uint8Array([
    ...ascii('RIFF'),
    ...u32le(30),
    ...ascii('WEBP'),
    ...ascii('VP8X'),
    ...u32le(10),
    0,
    0,
    0,
    0,
    w & 0xff,
    (w >> 8) & 0xff,
    (w >> 16) & 0xff,
    h & 0xff,
    (h >> 8) & 0xff,
    (h >> 16) & 0xff,
  ]);
}

export function ftypBytes(major: string, compatible: string[] = []): Uint8Array {
  const size = 16 + compatible.length * 4;
  return new Uint8Array([...u32be(size), ...ascii('ftyp'), ...ascii(major), 0, 0, 0, 0, ...compatible.flatMap(ascii), 0, 0, 0, 0]);
}

export const gifBytes = () => new Uint8Array(ascii('GIF89a\x01\x00\x01\x00'));
export const textBytes = (s = 'hello, this is not an image') => new Uint8Array(ascii(s));

export function blobOf(bytes: Uint8Array, name: string, type = ''): Blob & { name: string } {
  return Object.assign(new Blob([new Uint8Array(bytes)], { type }), { name });
}
