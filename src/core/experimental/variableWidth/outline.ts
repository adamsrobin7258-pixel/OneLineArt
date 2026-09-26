import type { VariableWidthLine } from './generate';

/**
 * The drawn shape of a variable-width line: ONE closed outline — the left
 * edge forward, a round cap, the right edge back, a round cap — filled with
 * the nonzero rule. One line stays one shape, also in SVG, and the width
 * changes continuously along it (no per-segment strokes, no seams).
 */

/** Longest miter at a joint, in half widths (the route has no sharp joints; this only guards). */
const MITER_LIMIT = 2;
const CAP_STEPS = 6;

export interface OutlineTransform {
  readonly scaleX: number;
  readonly scaleY: number;
  /** Factor for the widths (usually the mean of scaleX and scaleY). */
  readonly widthScale: number;
}

export function variableWidthOutline(
  coords: ArrayLike<number>,
  widths: ArrayLike<number>,
  t: OutlineTransform = { scaleX: 1, scaleY: 1, widthScale: 1 },
): Float64Array {
  const n = coords.length >> 1;
  if (n < 2) return new Float64Array(0);
  const px = (i: number) => coords[i * 2]! * t.scaleX;
  const py = (i: number) => coords[i * 2 + 1]! * t.scaleY;

  // Unit direction of every segment (a zero-length one borrows its predecessor's).
  const dir = new Float64Array((n - 1) * 2);
  let lastX = 1, lastY = 0;
  for (let i = 0; i < n - 1; i++) {
    const dx = px(i + 1) - px(i), dy = py(i + 1) - py(i);
    const len = Math.hypot(dx, dy);
    if (len > 1e-12) {
      lastX = dx / len;
      lastY = dy / len;
    }
    dir[i * 2] = lastX;
    dir[i * 2 + 1] = lastY;
  }
  const left = new Float64Array(n * 2);
  const right = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 2, i);
    // Normal of the averaged tangent; (−ty, tx) points to the left of the direction.
    let tx = dir[a * 2]! + dir[b * 2]!, ty = dir[a * 2 + 1]! + dir[b * 2 + 1]!;
    let len = Math.hypot(tx, ty);
    if (len < 1e-9) {
      tx = dir[b * 2]!;
      ty = dir[b * 2 + 1]!;
      len = 1;
    }
    tx /= len;
    ty /= len;
    const cos = tx * dir[b * 2]! + ty * dir[b * 2 + 1]!;
    const miter = Math.min(MITER_LIMIT, 1 / Math.max(1e-6, cos));
    const half = (widths[i]! * t.widthScale * miter) / 2;
    left[i * 2] = px(i) - ty * half;
    left[i * 2 + 1] = py(i) + tx * half;
    right[i * 2] = px(i) + ty * half;
    right[i * 2 + 1] = py(i) - tx * half;
  }

  const out = new Float64Array((2 * n + 2 * (CAP_STEPS - 1)) * 2);
  let o = 0;
  const put = (x: number, y: number) => {
    out[o++] = x;
    out[o++] = y;
  };
  const cap = (i: number, fromX: number, fromY: number, forward: boolean) => {
    // Half circle around point i from one edge to the other, bulging along (or against) the direction.
    const cx = px(i), cy = py(i);
    const a0 = Math.atan2(fromY - cy, fromX - cx);
    const r = Math.hypot(fromX - cx, fromY - cy);
    const d = forward ? dir[(n - 2) * 2]! : dir[0]!;
    const e = forward ? dir[(n - 2) * 2 + 1]! : dir[1]!;
    // Turn towards the outward direction (forward at the end, backward at the start).
    const sign = (forward ? 1 : -1) * (Math.cos(a0 + Math.PI / 2) * d + Math.sin(a0 + Math.PI / 2) * e) >= 0 ? 1 : -1;
    for (let k = 1; k < CAP_STEPS; k++) {
      const a = a0 + (sign * Math.PI * k) / CAP_STEPS;
      put(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
  };
  for (let i = 0; i < n; i++) put(left[i * 2]!, left[i * 2 + 1]!);
  cap(n - 1, left[(n - 1) * 2]!, left[(n - 1) * 2 + 1]!, true);
  for (let i = n - 1; i >= 0; i--) put(right[i * 2]!, right[i * 2 + 1]!);
  cap(0, right[0]!, right[1]!, false);
  return out.subarray(0, o);
}

export interface OutlineSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

/** Traces the outline as one closed subpath (fill it with the nonzero rule). */
export function traceOutline(outline: Float64Array, sink: OutlineSink): void {
  if (outline.length < 6) return;
  sink.moveTo(outline[0]!, outline[1]!);
  for (let i = 2; i < outline.length; i += 2) sink.lineTo(outline[i]!, outline[i + 1]!);
  sink.closePath();
}

export interface VariableWidthSvgOptions {
  /** Long edge of the SVG in px. */
  readonly longEdge: number;
  readonly color?: string;
  readonly background?: string | null;
}

/** Standalone SVG: the one line as a single filled <path>. */
export function variableWidthSvg(line: VariableWidthLine, o: VariableWidthSvgOptions): string {
  const { width: bw, height: bh } = line.path.bounds;
  const scale = o.longEdge / Math.max(bw, bh);
  const width = Math.round(bw * scale), height = Math.round(bh * scale);
  const outline = variableWidthOutline(line.path.coords, line.widths, { scaleX: width / bw, scaleY: height / bh, widthScale: scale });
  const parts: string[] = [];
  const f = (v: number) => (Math.round(v * 100) / 100).toString();
  for (let i = 0; i < outline.length; i += 2) parts.push(`${i === 0 ? 'M' : 'L'}${f(outline[i]!)} ${f(outline[i + 1]!)}`);
  const background = o.background === null ? '' : `<rect width="100%" height="100%" fill="${o.background ?? '#ffffff'}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `${background}<path fill="${o.color ?? '#000000'}" fill-rule="nonzero" d="${parts.join('')}Z"/></svg>`
  );
}
