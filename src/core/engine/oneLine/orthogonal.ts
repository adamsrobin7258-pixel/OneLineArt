import type { ScalarField } from '../../models';
import { pixelsPerDensePoint } from './demandField';
import { dropDuplicatePoints } from './geometry';
import type { LineShape } from './generateOneLine';
import type { Stipples } from './stippling';

export const ORTHOGONAL_ENGINE_ID = 'orthogonal-stipple-tour';
export const ORTHOGONAL_ENGINE_VERSION = '1.0.0';

/** Cost of one 90° turn in the corner choice (in turns); a 180° reversal costs this much more. */
const REVERSAL_COST = 8;

/** Axis of a step: 0 = horizontal, 1 = vertical; sign ±1. Zero steps have no direction. */
type Leg = { readonly axis: 0 | 1; readonly sign: number } | null;

const legOf = (dx: number, dy: number): Leg => (dx !== 0 ? { axis: 0, sign: Math.sign(dx) } : dy !== 0 ? { axis: 1, sign: Math.sign(dy) } : null);

/** Turn cost from leg a into leg b: 0 straight on, 1 for 90°, 1 + REVERSAL_COST for 180°. */
function turnCost(a: Leg, b: Leg): number {
  if (!a || !b) return 0;
  if (a.axis !== b.axis) return 1;
  return a.sign === b.sign ? 0 : 1 + REVERSAL_COST;
}

/**
 * Routes a polyline with ONLY horizontal and vertical legs: every connection
 * P→Q becomes an "L" (horizontal then vertical, or vertical then horizontal)
 * whose corner lies in the bounding box of P and Q — so the line never
 * leaves the canvas and its drawn length is exactly |dx| + |dy|.
 *
 * Which of the two corners is used is decided for the WHOLE line at once
 * (Viterbi over the two choices per connection): as few turns as possible,
 * straight runs continue through the points, and 180° reversals (the line
 * running back over itself) are avoided whenever an alternative exists.
 * Ties prefer horizontal-first. Deterministic; the points are copied exactly, so every leg
 * is exactly axis-parallel (equal x or equal y).
 */
export function orthogonalRoute(coords: Float64Array): Float64Array {
  const n = coords.length >> 1;
  if (n < 2) return coords;
  const m = n - 1;
  // Per connection and choice (0 = horizontal first, 1 = vertical first): first and last leg.
  const first: Leg[][] = [];
  const last: Leg[][] = [];
  for (let i = 0; i < m; i++) {
    const dx = coords[i * 2 + 2]! - coords[i * 2]!;
    const dy = coords[i * 2 + 3]! - coords[i * 2 + 1]!;
    const h = legOf(dx, 0), v = legOf(0, dy);
    first.push([h ?? v, v ?? h]);
    last.push([v ?? h, h ?? v]);
  }
  // Viterbi: cost[i][c] = fewest turns up to and including connection i with choice c.
  const cost = new Float64Array(m * 2);
  const from = new Uint8Array(m * 2);
  const inner = (i: number, c: number) => (first[i]![c] && last[i]![c] && first[i]![c]!.axis !== last[i]![c]!.axis ? 1 : 0);
  cost[0] = inner(0, 0);
  cost[1] = inner(0, 1);
  for (let i = 1; i < m; i++) {
    for (let c = 0; c < 2; c++) {
      let best = Infinity, arg = 0;
      for (let p = 0; p < 2; p++) {
        const value = cost[(i - 1) * 2 + p]! + turnCost(last[i - 1]![p]!, first[i]![c]!);
        if (value < best) {
          best = value;
          arg = p;
        }
      }
      cost[i * 2 + c] = best + inner(i, c);
      from[i * 2 + c] = arg;
    }
  }
  const choice = new Uint8Array(m);
  choice[m - 1] = cost[(m - 1) * 2 + 1]! < cost[(m - 1) * 2]! ? 1 : 0;
  for (let i = m - 1; i > 0; i--) choice[i - 1] = from[i * 2 + choice[i]!]!;

  const out = new Float64Array((2 * n - 1) * 2);
  let o = 0;
  out[o++] = coords[0]!;
  out[o++] = coords[1]!;
  for (let i = 0; i < m; i++) {
    const ax = coords[i * 2]!, ay = coords[i * 2 + 1]!;
    const bx = coords[i * 2 + 2]!, by = coords[i * 2 + 3]!;
    if (ax !== bx && ay !== by) {
      // Corner: (bx, ay) = horizontal first, (ax, by) = vertical first.
      out[o++] = choice[i] === 0 ? bx : ax;
      out[o++] = choice[i] === 0 ? ay : by;
    }
    out[o++] = bx;
    out[o++] = by;
  }
  return out.subarray(0, o);
}

/**
 * Drops zero-length legs and points in the middle of a straight run (same
 * axis and sign on both sides) — as long as the joined leg stays at most
 * `maxRun` long, so a long straight run keeps some of its own points and is
 * never mistaken for a jump.
 */
export function mergeOrthogonalRuns(coords: Float64Array, maxRun = Infinity): Float64Array {
  const n = coords.length >> 1;
  if (n < 2) return coords;
  const out = new Float64Array(coords.length);
  let o = 0;
  out[o++] = coords[0]!;
  out[o++] = coords[1]!;
  for (let i = 1; i < n; i++) {
    const x = coords[i * 2]!, y = coords[i * 2 + 1]!;
    if (x === out[o - 2] && y === out[o - 1]) continue;
    if (o >= 4) {
      const a = legOf(out[o - 2]! - out[o - 4]!, out[o - 1]! - out[o - 3]!);
      const b = legOf(x - out[o - 2]!, y - out[o - 1]!);
      const joined = Math.abs(x - out[o - 4]!) + Math.abs(y - out[o - 3]!);
      if (a && b && a.axis === b.axis && a.sign === b.sign && joined <= maxRun) o -= 2; // the middle point lies on the run
    }
    out[o++] = x;
    out[o++] = y;
  }
  return out.subarray(0, o);
}

/**
 * Removes small steps ("jogs") shorter than `tolerance`: a short leg between
 * two legs running in the SAME direction (…→ ↓ → …) is dropped and the rest
 * of the line continues on the first run's line. The following leg is
 * perpendicular to that run, so it only gets slightly longer or shorter and
 * stays axis-parallel; if it would vanish or flip, the step is kept.
 * U-turns (→ ↓ ←) are real shape and are never touched. Coordinates are
 * assigned, not recomputed, so the legs stay exactly axis-parallel.
 */
export function removeOrthogonalJogs(coords: Float64Array, tolerance: number, maxRun = Infinity): Float64Array {
  let pts = mergeOrthogonalRuns(coords, maxRun);
  if (!(tolerance > 0)) return pts;
  for (let pass = 0; pass < 4; pass++) {
    const n = pts.length >> 1;
    if (n < 4) return pts;
    const p = Float64Array.from(pts);
    const keep = new Uint8Array(n).fill(1);
    let changed = false;
    // Legs (i-1→i), (i→i+1) = the step, (i+1→i+2); the point i+2 is shifted.
    for (let i = 1; i + 2 < n; i++) {
      if (!keep[i] || !keep[i + 1]) continue;
      let prev = i - 1;
      while (prev > 0 && !keep[prev]) prev--;
      const before = legOf(p[i * 2]! - p[prev * 2]!, p[i * 2 + 1]! - p[prev * 2 + 1]!);
      const stepAxis = legOf(p[i * 2 + 2]! - p[i * 2]!, p[i * 2 + 3]! - p[i * 2 + 1]!);
      const after = legOf(p[i * 2 + 4]! - p[i * 2 + 2]!, p[i * 2 + 5]! - p[i * 2 + 3]!);
      if (!before || !stepAxis || !after || before.axis !== after.axis || before.sign !== after.sign || stepAxis.axis === before.axis) continue;
      const a = stepAxis.axis; // coordinate that the step changes
      const step = Math.abs(p[i * 2 + 2 + a]! - p[i * 2 + a]!);
      if (step >= tolerance) continue;
      // The leg after the shifted point must run along the step's axis and keep its direction.
      const j = i + 2;
      if (j + 1 < n) {
        const next = legOf(p[j * 2 + 2]! - p[j * 2]!, p[j * 2 + 3]! - p[j * 2 + 1]!);
        if (!next || next.axis !== a) continue;
        const shifted = p[j * 2 + 2 + a]! - p[i * 2 + a]!;
        if (Math.sign(shifted) !== next.sign) continue;
      }
      // Continue on the first run's line: the point after the step takes point i's coordinate.
      p[j * 2 + a] = p[i * 2 + a]!;
      keep[i] = 0;
      keep[i + 1] = 0;
      changed = true;
    }
    if (!changed) return pts;
    const out = new Float64Array(pts.length);
    let o = 0;
    for (let k = 0; k < n; k++) {
      if (!keep[k]) continue;
      out[o++] = p[k * 2]!;
      out[o++] = p[k * 2 + 1]!;
    }
    pts = mergeOrthogonalRuns(out.subarray(0, o), maxRun);
  }
  return pts;
}

/** Lattice pitch as a share of the point spacing in the densest area (there every node is used). */
const LATTICE_PITCH = 1;
/**
 * Deterministic offset of each lattice row / column, as a share of the pitch
 * (±). Exactly periodic lines beat with the pixel grid of every scaled
 * display (moiré bands); slightly irregular spacing turns that into noise.
 * Rows and columns stay straight lines, so the route stays orthogonal.
 */
const LATTICE_JITTER = 0.2;
/** Rows the error diffusion runs before the first lattice row (see latticePoints). */
const WARM_UP_ROWS = 8;

/**
 * Threshold noise of the error diffusion (± share): plain Floyd–Steinberg
 * turns large even areas into regular patterns (whole rows firing at once);
 * a little noise on the threshold breaks them up.
 */
const THRESHOLD_NOISE = 0.25;

/** Value in [-1, 1] for integer k on channel `axis` (integer hash, identical on every platform). */
function latticeOffset(k: number, axis: number): number {
  let h = Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(axis + 1, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/**
 * Demand points ON a square lattice, chosen by error diffusion (Floyd–
 * Steinberg, serpentine scan) of the expected points per node. The pitch is
 * the point spacing in the densest area, so there every node is used and the
 * route becomes clean parallel lines one pitch apart; lighter areas use fewer
 * nodes. Choosing nodes directly (instead of snapping freely placed points)
 * avoids aliasing bands and double-occupied nodes; see LATTICE_JITTER for the
 * slightly irregular line spacing. Deterministic, no seed.
 */
export function latticePoints(demand: ScalarField, count: number): Stipples {
  const { width, height, data } = demand;
  const pitch = Math.max(1e-6, LATTICE_PITCH * Math.sqrt(pixelsPerDensePoint(demand, Math.max(1, count))));
  const cols = Math.max(1, Math.floor(width / pitch)), rows = Math.max(1, Math.floor(height / pitch));
  const ox = (width - cols * pitch) / 2 + pitch / 2, oy = (height - rows * pitch) / 2 + pitch / 2;
  const colX = Float64Array.from({ length: cols }, (_, c) => ox + (c + LATTICE_JITTER * latticeOffset(c, 0)) * pitch);
  const rowY = Float64Array.from({ length: rows }, (_, r) => oy + (r + LATTICE_JITTER * latticeOffset(r, 1)) * pitch);
  // Bilinear: the pitch may be finer than the demand grid; nearest sampling would repeat pixel rows (banding).
  const at = (c: number, r: number) => {
    const fx = Math.min(width - 1, Math.max(0, colX[c]! - 0.5)), fy = Math.min(height - 1, Math.max(0, rowY[r]! - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const top = data[y0 * width + x0]! * (1 - tx) + data[y0 * width + x1]! * tx;
    const bottom = data[y1 * width + x0]! * (1 - tx) + data[y1 * width + x1]! * tx;
    return top * (1 - ty) + bottom * ty;
  };
  let total = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) total += Math.max(0, at(c, r));
  const scale = total > 0 ? count / total : 0;
  const xs: number[] = [], ys: number[] = [];
  let current = new Float64Array(cols), next = new Float64Array(cols);
  // Warm-up over mirrored rows above the lattice (nothing emitted): the error settles as it does inside
  // the image, otherwise the first rows of light areas would stay empty.
  const warmUp = Math.min(rows, WARM_UP_ROWS);
  for (let q = -warmUp; q < rows; q++) {
    const r = q < 0 ? -q - 1 : q;
    const forward = (q + warmUp) % 2 === 0;
    for (let k = 0; k < cols; k++) {
      const c = forward ? k : cols - 1 - k;
      const d = forward ? 1 : -1;
      const value = Math.max(0, at(c, r)) * scale + current[c]!;
      const on = value >= 0.5 + THRESHOLD_NOISE * latticeOffset((q + warmUp) * cols + c, 3);
      if (on && q >= 0) {
        xs.push(colX[c]!);
        ys.push(rowY[r]!);
      }
      const error = value - (on ? 1 : 0);
      // Shares that would leave the lattice sideways are folded into the next row (else the side edges run empty).
      const ahead = c + d >= 0 && c + d < cols, behind = c - d >= 0 && c - d < cols;
      let below = (error * 5) / 16;
      if (ahead) current[c + d]! += (error * 7) / 16;
      else below += (error * 7) / 16;
      if (behind) next[c - d]! += (error * 3) / 16;
      else below += (error * 3) / 16;
      if (ahead) next[c + d]! += error / 16;
      else below += error / 16;
      next[c]! += below;
    }
    [current, next] = [next, current];
    next.fill(0);
  }
  // A line needs two points.
  for (let k = 0; xs.length < 2; k++) {
    xs.push(colX[(k * (cols - 1)) % cols]!);
    ys.push(rowY[Math.min(rows - 1, k)]!);
  }
  return { xs: Float64Array.from(xs), ys: Float64Array.from(ys) };
}

/**
 * Drops tour points closer than `tolerance` to the last kept point (first and
 * last point stay). Lattice points lie at least ~half a pitch apart, far more
 * than the normal tolerance, so this only acts while the engine coarsens the
 * tolerance to respect `maxPoints`. Unlike Douglas–Peucker it never joins a
 * straight run of points into one long leg.
 */
function dropNearPoints(coords: Float64Array, tolerance: number): Float64Array {
  const n = coords.length >> 1;
  if (n < 3 || !(tolerance > 0)) return coords;
  const out = new Float64Array(coords.length);
  let o = 2;
  out[0] = coords[0]!;
  out[1] = coords[1]!;
  for (let i = 1; i < n - 1; i++) {
    const x = coords[i * 2]!, y = coords[i * 2 + 1]!;
    if (Math.abs(x - out[o - 2]!) + Math.abs(y - out[o - 1]!) < tolerance) continue;
    out[o++] = x;
    out[o++] = y;
  }
  out[o++] = coords[(n - 1) * 2]!;
  out[o++] = coords[(n - 1) * 2 + 1]!;
  return out.subarray(0, o);
}

/**
 * Orthogonal: only horizontal and vertical lines, 90° corners. Its own route:
 * the demand points are placed on a lattice, the tour is optimized for
 * orthogonal connections (see `connectionLength`), then routed with globally
 * chosen L-corners and cleaned of tiny steps. No smoothing.
 */
export const ORTHOGONAL_LINE_SHAPE: LineShape = {
  id: ORTHOGONAL_ENGINE_ID,
  version: ORTHOGONAL_ENGINE_VERSION,
  // Half the drawn (Manhattan) length, half the straight distance: in pure Manhattan length a crossing
  // and its uncrossed 2-opt alternative are often exactly equal, so the tour would keep its crossings.
  connectionLength: (dx, dy) => 0.5 * (Math.abs(dx) + Math.abs(dy)) + 0.5 * Math.hypot(dx, dy),
  placePoints: latticePoints,
  prepare: (raw) => raw,
  // No Douglas–Peucker on the tour: on the lattice it would only join straight runs, without the length limit.
  finish: (prepared, tolerance, maxSegmentLength) =>
    removeOrthogonalJogs(orthogonalRoute(dropDuplicatePoints(dropNearPoints(prepared, tolerance))), tolerance, maxSegmentLength),
};
