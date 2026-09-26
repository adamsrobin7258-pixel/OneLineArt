import type { Size } from '../../models';

/**
 * Centre lines of the variable-width line, in working-grid px. Each route is
 * built as ONE polyline from the start — the connections between rows (or
 * turns) are part of the construction, nothing is joined afterwards.
 * The geometry depends only on the canvas size, spacing and start, never on
 * the image: the spacing is the same in light and in dark areas by construction.
 */
export interface Route {
  /** Interleaved x/y. */
  readonly coords: Float64Array;
  /**
   * 1 where the point lies on the canvas border although the ideal route runs
   * outside (spiral corners): drawn with the minimum width, like a frame.
   */
  readonly frame: Uint8Array;
  /** Number of rows (meander) or turns (spiral). */
  readonly lines: number;
}

export interface RouteOptions {
  readonly spacing: number;
  /** Normalized start (0…1). */
  readonly start: { readonly x: number; readonly y: number };
  /** Longest distance between neighbouring samples, px. */
  readonly step: number;
}

class PolylineBuilder {
  private data: Float64Array;
  private flags: Uint8Array;
  length = 0;

  constructor(capacity: number) {
    this.data = new Float64Array(Math.max(4, capacity) * 2);
    this.flags = new Uint8Array(Math.max(4, capacity));
  }

  push(x: number, y: number, frame = 0): void {
    if (this.length > 0 && this.data[this.length * 2 - 2] === x && this.data[this.length * 2 - 1] === y) return;
    if (this.length === this.flags.length) {
      const data = new Float64Array(this.data.length * 2);
      data.set(this.data);
      this.data = data;
      const flags = new Uint8Array(this.flags.length * 2);
      flags.set(this.flags);
      this.flags = flags;
    }
    this.data[this.length * 2] = x;
    this.data[this.length * 2 + 1] = y;
    this.flags[this.length] = frame;
    this.length++;
  }

  build(lines: number): Route {
    return { coords: this.data.slice(0, this.length * 2), frame: this.flags.slice(0, this.length), lines };
  }
}

/**
 * Boustrophedon rows at exactly `spacing` apart (centred vertically; the rest
 * of the height, < spacing, is split between top and bottom). Consecutive rows
 * are joined by semicircles of radius spacing/2 that reach exactly to the
 * border: neighbouring turns are then `spacing` apart as well, and the line
 * never changes direction abruptly. Starts at the canvas corner nearest to
 * `start` (a meander can only start at a corner without drawing twice).
 */
export function meanderRows(size: Size, o: RouteOptions): Route {
  const { width: W, height: H } = size;
  const s = o.spacing;
  const rows = Math.max(1, Math.floor(H / s));
  const margin = (H - rows * s) / 2;
  const r = s / 2;
  // Narrower than one spacing: rows over the full width (the turns then lie on the border).
  const xLeft = W > s ? r : 0;
  const xRight = W > s ? W - r : W;
  const fromLeft = o.start.x < 0.5;
  const fromTop = o.start.y < 0.5;
  const rowY = (k: number) => {
    const y = margin + ((fromTop ? k : rows - 1 - k) + 0.5) * s;
    return Math.min(H, Math.max(0, y));
  };
  const arcSteps = Math.max(8, Math.ceil((Math.PI * r) / o.step));
  const b = new PolylineBuilder(Math.ceil(rows * ((xRight - xLeft) / o.step + arcSteps + 2)));

  for (let k = 0; k < rows; k++) {
    const y = rowY(k);
    const leftToRight = (k % 2 === 0) === fromLeft;
    const xa = leftToRight ? xLeft : xRight;
    const xb = leftToRight ? xRight : xLeft;
    const m = Math.max(1, Math.ceil(Math.abs(xb - xa) / o.step));
    for (let i = 0; i <= m; i++) b.push(xa + ((xb - xa) * i) / m, y);
    if (k === rows - 1) break;
    // Semicircle outward (beyond the row end) to the next row.
    const yNext = rowY(k + 1);
    const cy = (y + yNext) / 2;
    const radius = Math.abs(yNext - y) / 2;
    const down = yNext > y ? 1 : -1;
    const side = leftToRight ? 1 : -1;
    for (let i = 1; i < arcSteps; i++) {
      const phi = (Math.PI * i) / arcSteps;
      const x = Math.min(W, Math.max(0, xb + side * radius * Math.sin(phi)));
      b.push(x, cy - down * radius * Math.cos(phi));
    }
  }
  return b.build(rows);
}

/** The same meander with vertical columns (rows of the transposed canvas). */
export function meanderColumns(size: Size, o: RouteOptions): Route {
  const t = meanderRows({ width: size.height, height: size.width }, { ...o, start: { x: o.start.y, y: o.start.x } });
  const coords = new Float64Array(t.coords.length);
  for (let i = 0; i < coords.length; i += 2) {
    coords[i] = t.coords[i + 1]!;
    coords[i + 1] = t.coords[i]!;
  }
  return { coords, frame: t.frame, lines: t.lines };
}

/** Largest angle step of the spiral (keeps the innermost turns round). */
const MAX_SPIRAL_ANGLE_STEP = 0.35;

/**
 * Archimedean spiral r = spacing · θ / 2π around `start`: neighbouring turns
 * are exactly `spacing` apart everywhere and the line never turns sharply.
 * It grows until it has passed every corner. Where a turn leaves the canvas,
 * the point is projected onto the border (continuous: the line runs along the
 * edge until the turn comes back) and marked as frame.
 */
export function spiral(size: Size, o: RouteOptions): Route {
  const { width: W, height: H } = size;
  const s = o.spacing;
  const cx = o.start.x * W;
  const cy = o.start.y * H;
  const reach = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy)) + s / 2;
  const a = s / (2 * Math.PI);
  const thetaMax = reach / a;
  const b = new PolylineBuilder(Math.ceil((Math.PI * reach * reach) / (s * o.step)) + 16);
  let theta = 0;
  for (;;) {
    const r = a * theta;
    const x = cx + r * Math.cos(theta);
    const y = cy + r * Math.sin(theta);
    const px = Math.min(W, Math.max(0, x));
    const py = Math.min(H, Math.max(0, y));
    b.push(px, py, px !== x || py !== y ? 1 : 0);
    if (theta >= thetaMax) break;
    theta = Math.min(thetaMax, theta + Math.min(MAX_SPIRAL_ANGLE_STEP, o.step / Math.hypot(r, a)));
  }
  return b.build(Math.ceil(thetaMax / (2 * Math.PI)));
}
