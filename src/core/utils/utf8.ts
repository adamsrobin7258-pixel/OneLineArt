/** UTF-8 without DOM APIs (the core has no TextEncoder/TextDecoder). */
export function encodeUtf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const char of text) {
    const c = char.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}

/** Strict decoding: invalid or overlong sequences and lone surrogates throw a RangeError. */
export function decodeUtf8(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    const n = b < 0x80 ? 0 : b >= 0xc2 && b < 0xe0 ? 1 : b >= 0xe0 && b < 0xf0 ? 2 : b >= 0xf0 && b < 0xf5 ? 3 : -1;
    if (n < 0) throw new RangeError('Invalid UTF-8');
    let c = n === 0 ? b : b & (0x3f >> n);
    for (let k = 1; k <= n; k++) {
      const next = bytes[i + k];
      if (next === undefined || (next & 0xc0) !== 0x80) throw new RangeError('Invalid UTF-8');
      c = (c << 6) | (next & 0x3f);
    }
    if ((n === 2 && c < 0x800) || (n === 3 && (c < 0x10000 || c > 0x10ffff)) || (c >= 0xd800 && c <= 0xdfff)) throw new RangeError('Invalid UTF-8');
    text += String.fromCodePoint(c);
    i += n + 1;
  }
  return text;
}
