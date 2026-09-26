import type { Size } from '../../models';
import { meanderRows, type Route, type RouteOptions } from './routes';

/**
 * Phase 15.2: curved centre lines at (near) constant spacing. Like the
 * Phase 15.1 routes (routes.ts, unchanged), every route here is built from the
 * canvas size, the spacing and the start ONLY — never from the image — and as
 * ONE polyline: rows are joined by turns while they are generated.
 *
 * Geometry background (why these three families):
 * - Exactly constant spacing means the rows are PARALLEL CURVES (offsets) of
 *   one base curve. Offsets stay smooth only while the distance to the base
 *   stays below its radius of curvature, so large areas allow only gentle bends.
 * - A family whose rows run from the left to the right edge AND fill the
 *   rectangle has the top edge as a row; its offsets are straight. Curved,
 *   full-width rows therefore cannot keep the spacing exactly
 *   (organicMeander: measured approximation).
 * - A single path without a frame needs every row to cross the rectangle in ONE
 *   piece. That is guaranteed when every row is monotonic in x and y (tangent
 *   inside one open quadrant): flowCurve and arcSpiral are built that way.
 *   Concentric circles around a point INSIDE the picture always split into
 *   several arcs towards the corners (they would need jumps or a frame), so the
 *   spiral centre lies at or beyond the start corner.
 */

export interface CurvedRouteDiagnostics {
  /** Rows that crossed the canvas in more than one piece (0 by construction). */
  readonly splitRows: number;
  /** Offset samples beyond a curvature centre (cusps) inside the canvas (0 by construction). */
  readonly cusps: number;
  /** Points moved back onto the canvas (turn corners, float rounding). */
  readonly clamped: number;
}

export interface CurvedRoute extends Route {
  readonly curved: CurvedRouteDiagnostics;
}

type Point = [number, number];

/** A row: polyline samples ≤ step apart, in drawing order not yet decided. */
type Row = Float64Array;

function reversed(row: Row): Row {
  const out = new Float64Array(row.length);
  for (let i = 0; i < row.length; i += 2) {
    out[i] = row[row.length - 2 - i]!;
    out[i + 1] = row[row.length - 1 - i]!;
  }
  return out;
}

/**
 * The part of a polyline inside [0,W]×[0,H], with exact entry/exit points.
 * Returns the longest inside piece and how many pieces there were.
 */
function clipToCanvas(poly: ArrayLike<number>, W: number, H: number): { row: Row | null; pieces: number } {
  const inside = (x: number, y: number) => x >= 0 && x <= W && y >= 0 && y <= H;
  const n = poly.length >> 1;
  const crossing = (i: number, j: number): Point => {
    // Point on segment i→j where it crosses the canvas border (bisection; the segment is ≤ step long).
    let a = 0, b = 1;
    const ax = poly[i * 2]!, ay = poly[i * 2 + 1]!, bx = poly[j * 2]!, by = poly[j * 2 + 1]!;
    const aIn = inside(ax, ay);
    for (let k = 0; k < 40; k++) {
      const m = (a + b) / 2;
      if (inside(ax + (bx - ax) * m, ay + (by - ay) * m) === aIn) a = m;
      else b = m;
    }
    const t = aIn ? a : b;
    return [Math.min(W, Math.max(0, ax + (bx - ax) * t)), Math.min(H, Math.max(0, ay + (by - ay) * t))];
  };
  let best: number[] | null = null;
  let current: number[] | null = null;
  let pieces = 0;
  for (let i = 0; i < n; i++) {
    const x = poly[i * 2]!, y = poly[i * 2 + 1]!;
    if (inside(x, y)) {
      if (!current) {
        pieces++;
        current = i > 0 ? [...crossing(i - 1, i)] : [];
      }
      current.push(x, y);
    } else if (current) {
      current.push(...crossing(i - 1, i));
      if (!best || current.length > best.length) best = current;
      current = null;
    }
  }
  if (current && (!best || current.length > best.length)) best = current;
  return { row: best && best.length >= 4 ? Float64Array.from(best) : null, pieces };
}

/** Cubic Bézier U-turn from the end of one row to the start of the next, tangents continuous. */
function pushTurn(out: number[], p0: Point, t0: Point, p3: Point, t3: Point, step: number): void {
  const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  // (2/3)·chord: for opposite tangents this is the usual one-cubic semicircle (bulge = chord / 2).
  const h = (2 / 3) * chord;
  const p1: Point = [p0[0] + t0[0] * h, p0[1] + t0[1] * h];
  const p2: Point = [p3[0] - t3[0] * h, p3[1] - t3[1] * h];
  const steps = Math.max(8, Math.ceil((1.6 * chord) / step));
  for (let i = 1; i < steps; i++) {
    const t = i / steps, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push(a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]);
  }
}

const tangentAt = (row: Row, i: number): Point => {
  const n = row.length >> 1;
  const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
  const dx = row[b * 2]! - row[a * 2]!, dy = row[b * 2 + 1]! - row[a * 2 + 1]!;
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
};

/** Whether the half disk (radius r, centre c, bulging along t) lies inside the canvas. */
function halfDiskFits(cx: number, cy: number, t: Point, r: number, W: number, H: number): boolean {
  for (let i = 0; i <= 12; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 12;
    const ux = t[0] * Math.cos(a) - t[1] * Math.sin(a), uy = t[0] * Math.sin(a) + t[1] * Math.cos(a);
    const x = cx + ux * r, y = cy + uy * r;
    if (x < 0 || x > W || y < 0 || y > H) return false;
  }
  return true;
}

/**
 * Where to leave row `a` (walking back from its end) and enter row `b` for a
 * U-turn that is a half circle of diameter ≈ spacing lying entirely inside
 * the canvas: the turn centre sits on the midline between the rows as close to
 * the border as the half circle allows. For rows perpendicular to the border
 * this is exactly the Phase 15.1 turn (apex touching the border). Returns the
 * cut indices, or null when no such place exists (tiny rows in a corner).
 */
function turnCut(a: Row, b: Row, s: number, W: number, H: number): { i: number; j: number } | null {
  const na = a.length >> 1, nb = b.length >> 1;
  const bEnd: Point = [b[0]!, b[1]!];
  let j = 0;
  for (let i = na - 1; i >= 0; i--) {
    const t = tangentAt(a, i);
    // Normal towards row b.
    let nx = -t[1], ny = t[0];
    if ((bEnd[0] - a[i * 2]!) * nx + (bEnd[1] - a[i * 2 + 1]!) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const cx = a[i * 2]! + nx * (s / 2), cy = a[i * 2 + 1]! + ny * (s / 2);
    if (!halfDiskFits(cx, cy, t, s / 2, W, H)) continue;
    // Entry on row b: the point nearest to the far end of the diameter.
    const tx = cx + nx * (s / 2), ty = cy + ny * (s / 2);
    let best = Infinity;
    for (let k = 0; k < nb; k++) {
      const d = (b[k * 2]! - tx) ** 2 + (b[k * 2 + 1]! - ty) ** 2;
      if (d < best) {
        best = d;
        j = k;
      }
    }
    if (Math.sqrt(best) > s) return null;
    return { i, j };
  }
  return null;
}

/**
 * Joins rows (already in sweep order) into one boustrophedon: the first row
 * starts at the end nearest `startCorner`, directions alternate, and each pair
 * of consecutive ends is joined by a half-circle U-turn inside the canvas (see
 * turnCut). Anything that still leaves the canvas is clamped (counted).
 */
function assemble(input: Row[], size: Size, startCorner: Point, step: number, lines: number, diag: { splitRows: number; cusps: number; spacing: number }): CurvedRoute {
  const { width: W, height: H } = size;
  const s = diag.spacing;
  // 1. Orientation: every row starts at the end nearer to where the previous one stops.
  const rows: Row[] = [];
  input.forEach((row, k) => {
    const n = row.length >> 1;
    const [px, py] = k === 0 ? startCorner : [rows[k - 1]![rows[k - 1]!.length - 2]!, rows[k - 1]![rows[k - 1]!.length - 1]!];
    const toStart = Math.hypot(row[0]! - px, row[1]! - py), toEnd = Math.hypot(row[(n - 1) * 2]! - px, row[(n - 1) * 2 + 1]! - py);
    rows.push(toEnd < toStart ? reversed(row) : row);
  });
  // 2. Cuts for the turns: row k ends at endCut[k], row k+1 starts at startCut[k+1].
  const startCut = new Int32Array(rows.length);
  const endCut = Int32Array.from(rows, (r) => (r.length >> 1) - 1);
  for (let k = 0; k + 1 < rows.length; k++) {
    const cut = turnCut(rows[k]!, rows[k + 1]!, s, W, H);
    if (!cut || cut.i <= startCut[k]!) continue;
    endCut[k] = cut.i;
    startCut[k + 1] = cut.j;
  }
  // 3. Polyline: rows between their cuts, joined by U-turns.
  const out: number[] = [];
  rows.forEach((row, k) => {
    const from = startCut[k]!, to = Math.max(from, endCut[k]!);
    if (k > 0) {
      const prev = rows[k - 1]!;
      const pe = endCut[k - 1]!;
      const p0: Point = [out[out.length - 2]!, out[out.length - 1]!];
      pushTurn(out, p0, tangentAt(prev, pe), [row[from * 2]!, row[from * 2 + 1]!], tangentAt(row, from), step);
    }
    for (let i = from; i <= to; i++) out.push(row[i * 2]!, row[i * 2 + 1]!);
  });
  const coords = new Float64Array(out.length);
  let clamped = 0;
  for (let i = 0; i < out.length; i += 2) {
    const x = Math.min(W, Math.max(0, out[i]!)), y = Math.min(H, Math.max(0, out[i + 1]!));
    if (x !== out[i] || y !== out[i + 1]) clamped++;
    coords[i] = x;
    coords[i + 1] = y;
  }
  return { coords, frame: new Uint8Array(coords.length >> 1), lines, curved: { splitRows: diag.splitRows, cusps: diag.cusps, clamped } };
}

const cornerOf = (size: Size, start: RouteOptions['start']): Point => [start.x < 0.5 ? 0 : size.width, start.y < 0.5 ? 0 : size.height];

function fallback(size: Size, o: RouteOptions): CurvedRoute {
  const r = meanderRows(size, o);
  return { ...r, curved: { splitRows: 0, cusps: 0, clamped: 0 } };
}

// ---------------------------------------------------------------------------
// Variant B – spiral arcs around a centre at or beyond the start corner
// ---------------------------------------------------------------------------

/**
 * Concentric circular arcs at exactly `spacing` apart around a centre that lies
 * on the diagonal through the start corner, `centerDistance` × diagonal beyond
 * it (0 = at the corner). Seen from there the canvas lies in one quadrant, so
 * every circle crosses it in one arc: one continuous meander of arcs, no frame,
 * no bull's-eye inside the picture. The line starts at the corner.
 */
export function arcSpiral(size: Size, o: RouteOptions, centerDistance: number): CurvedRoute {
  const { width: W, height: H } = size;
  const s = o.spacing;
  if (W <= 2 * s || H <= 2 * s) return fallback(size, o);
  const diagonal = Math.hypot(W, H);
  const corner = cornerOf(size, o.start);
  const out: Point = [(corner[0] - W / 2) / (diagonal / 2), (corner[1] - H / 2) / (diagonal / 2)];
  const cx = corner[0] + out[0] * centerDistance * diagonal;
  const cy = corner[1] + out[1] * centerDistance * diagonal;
  const corners: Point[] = [[0, 0], [W, 0], [0, H], [W, H]];
  const rCorner = Math.hypot(corner[0] - cx, corner[1] - cy);
  const rFar = Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy)));
  const angles = corners.map(([x, y]) => Math.atan2(y - cy, x - cx));
  // The canvas spans less than 180° seen from the centre: unwrap around the mean direction.
  const mean = Math.atan2(H / 2 - cy, W / 2 - cx);
  const rel = angles.map((a) => Math.atan2(Math.sin(a - mean), Math.cos(a - mean)));
  const aMin = mean + Math.min(...rel) - 0.05, aMax = mean + Math.max(...rel) + 0.05;

  const rows: Row[] = [];
  let splitRows = 0;
  for (let r = rCorner + s / 2; r < rFar; r += s) {
    const n = Math.max(8, Math.ceil(((aMax - aMin) * r) / o.step));
    const poly = new Float64Array((n + 1) * 2);
    for (let i = 0; i <= n; i++) {
      const a = aMin + ((aMax - aMin) * i) / n;
      poly[i * 2] = cx + r * Math.cos(a);
      poly[i * 2 + 1] = cy + r * Math.sin(a);
    }
    const clip = clipToCanvas(poly, W, H);
    if (clip.pieces > 1) splitRows++;
    if (clip.row) rows.push(clip.row);
  }
  if (rows.length === 0) return fallback(size, o);
  return assemble(rows, size, corner, o.step, rows.length, { splitRows, cusps: 0, spacing: s });
}

// ---------------------------------------------------------------------------
// Variant D – flowing curve: exact offsets of one slow "river" curve
// ---------------------------------------------------------------------------

/** Keeps every tangent this far inside its quadrant (rows stay monotonic in x and y). */
const QUADRANT_MARGIN = (5 * Math.PI) / 180;
/** Largest distance × curvature of any row inside the canvas (1 = cusp). */
const CURVATURE_LIMIT = 0.75;

interface BaseCurve {
  /** x, y, tangent angle, curvature per sample (step du). */
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly angle: Float64Array;
  readonly kappa: Float64Array;
}

/**
 * Sine-generated curve (the classic model of river meanders): tangent angle
 * θ(u) = θ0 + A·sin(2πu/L + φ), through (x0, y0) at u = 0, sampled every du
 * over u ∈ [−reach, reach].
 */
function riverCurve(x0: number, y0: number, theta0: number, amplitude: number, wavelength: number, phase: number, reach: number, du: number): BaseCurve {
  const n = Math.ceil(reach / du);
  const count = 2 * n + 1;
  const x = new Float64Array(count), y = new Float64Array(count), angle = new Float64Array(count), kappa = new Float64Array(count);
  const k = (2 * Math.PI) / wavelength;
  const theta = (u: number) => theta0 + amplitude * Math.sin(k * u + phase);
  for (let i = 0; i < count; i++) {
    const u = (i - n) * du;
    angle[i] = theta(u);
    kappa[i] = amplitude * k * Math.cos(k * u + phase);
  }
  x[n] = x0;
  y[n] = y0;
  // Midpoint integration outwards from the centre sample.
  for (let i = n + 1; i < count; i++) {
    const a = theta((i - n - 0.5) * du);
    x[i] = x[i - 1]! + Math.cos(a) * du;
    y[i] = y[i - 1]! + Math.sin(a) * du;
  }
  for (let i = n - 1; i >= 0; i--) {
    const a = theta((i - n + 0.5) * du);
    x[i] = x[i + 1]! - Math.cos(a) * du;
    y[i] = y[i + 1]! - Math.sin(a) * du;
  }
  return { x, y, angle, kappa };
}

/** Signed distance of a point to the base curve (positive along the left normal (−sinθ, cosθ)). */
function signedDistance(c: BaseCurve, px: number, py: number): number {
  let best = Infinity, bi = 0;
  for (let i = 0; i < c.x.length; i++) {
    const d = (c.x[i]! - px) ** 2 + (c.y[i]! - py) ** 2;
    if (d < best) {
      best = d;
      bi = i;
    }
  }
  return -Math.sin(c.angle[bi]!) * (px - c.x[bi]!) + Math.cos(c.angle[bi]!) * (py - c.y[bi]!);
}

export interface FlowOptions {
  /** Mean direction of the rows, measured from the x axis, as a share of the free quadrant (0…1). */
  readonly tilt: number;
  /** 0…1 share of the largest bend that keeps every row smooth and monotonic. */
  readonly bend: number;
  /** Wavelength of the river curve in canvas diagonals. */
  readonly wavelength: number;
}

/**
 * Rows are the exact parallel curves (offsets d = k·spacing) of one slow
 * sine-generated curve through the canvas centre. The spacing between
 * neighbouring rows is therefore exactly `spacing` everywhere on the rows.
 * The bend is limited so that no row gets a cusp and every row stays
 * monotonic (one piece, no frame). The rows sweep from the start corner to
 * the opposite one; turns join them inside the canvas.
 */
export function flowCurve(size: Size, o: RouteOptions, f: FlowOptions): CurvedRoute {
  const { width: W, height: H } = size;
  const s = o.spacing;
  if (W <= 2 * s || H <= 2 * s) return fallback(size, o);
  const diagonal = Math.hypot(W, H);
  const corner = cornerOf(size, o.start);
  const opposite: Point = [W - corner[0], H - corner[1]];
  // Rows run across the sweep direction (start corner → opposite corner): their tangents lie in the
  // quadrant spanned by the two other corners' directions.
  const sx = corner[0] === 0 ? 1 : -1, sy = corner[1] === 0 ? 1 : -1;
  // Row direction quadrant: (+sx, −sy) — e.g. start top-left: rows go right and up.
  const quadStart = Math.atan2(0, sx), quadEnd = Math.atan2(-sy, 0);
  let span = quadEnd - quadStart;
  if (span > Math.PI) span -= 2 * Math.PI;
  if (span < -Math.PI) span += 2 * Math.PI;
  const usable = Math.abs(span) - 2 * QUADRANT_MARGIN;
  const tilt = Math.min(1, Math.max(0, f.tilt));
  const theta0 = quadStart + Math.sign(span) * (QUADRANT_MARGIN + usable * tilt);
  const distToEdge = Math.min(tilt, 1 - tilt) * usable;
  const wavelength = Math.max(0.3, f.wavelength) * diagonal;
  const dMax = diagonal / 2 + s;
  const byCurvature = (CURVATURE_LIMIT * wavelength) / (2 * Math.PI * dMax);
  const amplitude = Math.min(1, Math.max(0, f.bend)) * Math.min(distToEdge, byCurvature);

  const du = Math.min(0.5, o.step / 2.5);
  const base = riverCurve(W / 2, H / 2, theta0, amplitude, wavelength, Math.PI / 2, 1.5 * diagonal, du);
  const d0 = signedDistance(base, corner[0], corner[1]);
  const d1 = signedDistance(base, opposite[0], opposite[1]);
  const dir = Math.sign(d1 - d0) || 1;
  const rows: Row[] = [];
  let splitRows = 0, cusps = 0;
  const count = base.x.length;
  const poly = new Float64Array(count * 2);
  for (let d = d0 + dir * (s / 2); dir > 0 ? d < d1 : d > d1; d += dir * s) {
    for (let i = 0; i < count; i++) {
      const a = base.angle[i]!;
      const x = base.x[i]! - Math.sin(a) * d, y = base.y[i]! + Math.cos(a) * d;
      poly[i * 2] = x;
      poly[i * 2 + 1] = y;
      if (1 - d * base.kappa[i]! <= 0 && x >= 0 && x <= W && y >= 0 && y <= H) cusps++;
    }
    const clip = clipToCanvas(poly, W, H);
    if (clip.pieces > 1) splitRows++;
    if (clip.row) rows.push(clip.row);
  }
  if (rows.length === 0) return fallback(size, o);
  return assemble(rows, size, corner, o.step, rows.length, { splitRows, cusps, spacing: s });
}

// ---------------------------------------------------------------------------
// Variant C – organic meander: full-width rows with a slow, measured bend
// ---------------------------------------------------------------------------

/** Largest vertical spacing change the bend may cause (relative), at bend = 1. */
const ORGANIC_MAX_DEVIATION = 0.12;

/**
 * Rows from the left to the right edge like the reference meander, displaced
 * vertically by a slow deterministic field: A · sin(πY/H) · h(x, Y), where h is
 * the sum of two long waves (1.35 and 0.8 canvas widths) whose phases drift
 * slowly from row to row. sin(πY/H) keeps the first and last rows straight, so
 * the rows fill the canvas exactly. As explained above, such rows cannot keep
 * the spacing exactly: A is chosen so that the spacing changes by at most
 * bend × 12 % (measured by the spacing metrics).
 */
export function organicMeander(size: Size, o: RouteOptions, bend: number): CurvedRoute {
  const { width: W, height: H } = size;
  const s = o.spacing;
  const rowsCount = Math.floor(H / s);
  if (W <= 2 * s || rowsCount < 3) return fallback(size, o);
  const margin = (H - rowsCount * s) / 2;
  const l1 = 1.35 * W, l2 = 0.8 * W, m1 = 2.2 * H, m2 = 3.1 * H;
  const h = (x: number, Y: number) =>
    0.62 * Math.sin((2 * Math.PI * x) / l1 + (2 * Math.PI * Y) / m1) + 0.38 * Math.sin((2 * Math.PI * x) / l2 - (2 * Math.PI * Y) / m2 + 1.3);
  const field = (x: number, Y: number) => Math.sin((Math.PI * Y) / H) * h(x, Y);
  // Largest |∂field/∂Y| on a coarse grid → amplitude for the allowed deviation.
  let steepest = 1e-9;
  for (let gy = 0; gy <= 64; gy++) {
    for (let gx = 0; gx <= 64; gx++) {
      const x = (gx / 64) * W, Y = (gy / 64) * H;
      steepest = Math.max(steepest, Math.abs(field(x, Y + 0.5) - field(x, Y - 0.5)));
    }
  }
  const amplitude = (Math.min(1, Math.max(0, bend)) * ORGANIC_MAX_DEVIATION) / steepest;
  const fromTop = o.start.y < 0.5;
  // Rows span the full width; assemble() cuts them where their half-circle turns fit.
  const xa = 0, xb = W;
  const n = Math.max(2, Math.ceil((xb - xa) / (o.step * 0.9)));
  const rows: Row[] = [];
  for (let k = 0; k < rowsCount; k++) {
    const Y = margin + ((fromTop ? k : rowsCount - 1 - k) + 0.5) * s;
    const row = new Float64Array((n + 1) * 2);
    for (let i = 0; i <= n; i++) {
      const x = xa + ((xb - xa) * i) / n;
      row[i * 2] = x;
      row[i * 2 + 1] = Y + amplitude * field(x, Y);
    }
    rows.push(row);
  }
  return assemble(rows, size, cornerOf(size, o.start), o.step, rows.length, { splitRows: 0, cusps: 0, spacing: s });
}
