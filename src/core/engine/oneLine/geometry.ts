/**
 * Chaikin corner cutting for an OPEN polyline (interleaved x/y).
 * Endpoints are kept; every new point is a convex combination of existing
 * neighbours, so the result never leaves the convex hull (→ never leaves the
 * canvas) and never introduces jumps.
 */
export function chaikinOpen(coords: Float64Array, iterations: number, ratio: number): Float64Array {
  const r = Math.min(0.49, Math.max(0.01, ratio));
  let pts = coords;
  for (let it = 0; it < iterations; it++) {
    const n = pts.length >> 1;
    if (n < 3) return pts;
    const out = new Float64Array((2 * (n - 1)) * 2);
    let o = 0;
    out[o++] = pts[0]!;
    out[o++] = pts[1]!;
    for (let i = 0; i < n - 1; i++) {
      const x0 = pts[i * 2]!, y0 = pts[i * 2 + 1]!, x1 = pts[i * 2 + 2]!, y1 = pts[i * 2 + 3]!;
      if (i > 0) {
        out[o++] = x0 + (x1 - x0) * r;
        out[o++] = y0 + (y1 - y0) * r;
      }
      if (i < n - 2) {
        out[o++] = x0 + (x1 - x0) * (1 - r);
        out[o++] = y0 + (y1 - y0) * (1 - r);
      }
    }
    out[o++] = pts[(n - 1) * 2]!;
    out[o++] = pts[(n - 1) * 2 + 1]!;
    pts = out.subarray(0, o);
  }
  return pts;
}

/**
 * Douglas–Peucker simplification (iterative, no recursion limits). Keeps a
 * subset of the original points IN ORDER, so the line stays one connected
 * path; no point deviates more than `tolerance` from the simplified line.
 */
export function simplifyPolyline(coords: Float64Array, tolerance: number): Float64Array {
  const n = coords.length >> 1;
  if (n <= 2 || tolerance <= 0) return coords;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const last = stack.pop()!;
    const first = stack.pop()!;
    const ax = coords[first * 2]!, ay = coords[first * 2 + 1]!;
    const bx = coords[last * 2]!, by = coords[last * 2 + 1]!;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1, index = -1;
    for (let i = first + 1; i < last; i++) {
      const px = coords[i * 2]! - ax, py = coords[i * 2 + 1]! - ay;
      let d2: number;
      if (len2 === 0) d2 = px * px + py * py;
      else {
        const t = Math.min(1, Math.max(0, (px * dx + py * dy) / len2));
        const ex = px - t * dx, ey = py - t * dy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > maxD) {
        maxD = d2;
        index = i;
      }
    }
    if (index >= 0 && maxD > tol2) {
      keep[index] = 1;
      stack.push(first, index, index, last);
    }
  }
  let count = 0;
  for (let i = 0; i < n; i++) count += keep[i]!;
  const out = new Float64Array(count * 2);
  let o = 0;
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    out[o++] = coords[i * 2]!;
    out[o++] = coords[i * 2 + 1]!;
  }
  return out;
}

/** Drops consecutive duplicate points (zero-length segments). */
export function dropDuplicatePoints(coords: Float64Array, epsilon = 1e-6): Float64Array {
  const n = coords.length >> 1;
  if (n < 2) return coords;
  const out = new Float64Array(coords.length);
  let o = 2;
  out[0] = coords[0]!;
  out[1] = coords[1]!;
  for (let i = 1; i < n; i++) {
    const x = coords[i * 2]!, y = coords[i * 2 + 1]!;
    if (Math.abs(x - out[o - 2]!) <= epsilon && Math.abs(y - out[o - 1]!) <= epsilon) continue;
    out[o++] = x;
    out[o++] = y;
  }
  // Keep at least two points so a degenerate input still forms a (tiny) line.
  if (o === 2 && n >= 2) {
    out[o++] = coords[(n - 1) * 2]!;
    out[o++] = coords[(n - 1) * 2 + 1]!;
  }
  return out.slice(0, o);
}
