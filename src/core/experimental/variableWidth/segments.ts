/**
 * Phase 15.4: straight-segment statistics of an orthogonal line.
 *
 * A segment is a maximal straight run between two direction changes (or an
 * end). On the Free Orthogonal lattice every segment is a whole multiple of
 * the spacing, so the shortest possible segment is exactly one spacing.
 * Descriptive only; lengths are reported in units of the spacing.
 */

export interface SegmentStats {
  readonly count: number;
  /** In spacings. */
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly median: number;
  readonly p05: number;
  readonly p25: number;
  readonly p75: number;
  readonly p95: number;
  /** Share of segments no longer than 1, 1.5, 2 and 3 spacings (lattice lengths are whole spacings). */
  readonly atMost1: number;
  readonly atMost1_5: number;
  readonly atMost2: number;
  readonly atMost3: number;
  /**
   * Share of segments at most two spacings long that lie between two turns of
   * opposite rotation: the steps of a ┐└┐└ staircase (on the lattice a
   * staircase of the tree gives steps of two spacings).
   */
  readonly stairShare: number;
  /** Direction changes per 100 spacings of line. */
  readonly turnsPer100: number;
}

/** Tolerance for "a whole multiple of the spacing" (float coordinates). */
const EPS = 1e-3;

/**
 * Segment lengths (px) and the turn direction at the end of each segment
 * (+1 clockwise, −1 counter-clockwise, 0 at the last segment).
 */
export function straightSegments(coords: ArrayLike<number>): { lengths: Float64Array; turns: Int8Array } {
  const lengths: number[] = [];
  const turns: number[] = [];
  let dx = 0, dy = 0, run = 0;
  for (let i = 2; i < coords.length; i += 2) {
    const ex = coords[i]! - coords[i - 2]!, ey = coords[i + 1]! - coords[i - 1]!;
    const len = Math.hypot(ex, ey);
    if (len === 0) continue;
    const ux = ex / len, uy = ey / len;
    if (run > 0 && Math.abs(ux * dy - uy * dx) > 1e-6) {
      lengths.push(run);
      turns.push(Math.sign(dx * uy - dy * ux));
      run = 0;
    }
    dx = ux;
    dy = uy;
    run += len;
  }
  if (run > 0) {
    lengths.push(run);
    turns.push(0);
  }
  return { lengths: Float64Array.from(lengths), turns: Int8Array.from(turns) };
}

const quantile = (sorted: Float64Array, q: number) => (sorted.length ? sorted[Math.round(q * (sorted.length - 1))]! : 0);

export function segmentStats(coords: ArrayLike<number>, spacing: number): SegmentStats {
  const { lengths, turns } = straightSegments(coords);
  const n = lengths.length;
  const units = lengths.map((l) => l / spacing);
  const sorted = Float64Array.from(units).sort();
  let sum = 0, a1 = 0, a15 = 0, a2 = 0, a3 = 0, stairs = 0;
  for (let i = 0; i < n; i++) {
    const u = units[i]!;
    sum += u;
    if (u <= 1 + EPS) a1++;
    if (u <= 1.5 + EPS) a15++;
    if (u <= 2 + EPS) a2++;
    if (u <= 3 + EPS) a3++;
    // Short segment between two turns of opposite rotation: a stair step.
    if (i > 0 && u <= 2 + EPS && turns[i - 1]! * turns[i]! < 0) stairs++;
  }
  const share = (k: number) => (n ? k / n : 0);
  return {
    count: n,
    min: n ? sorted[0]! : 0,
    max: n ? sorted[n - 1]! : 0,
    mean: n ? sum / n : 0,
    median: quantile(sorted, 0.5),
    p05: quantile(sorted, 0.05),
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
    p95: quantile(sorted, 0.95),
    atMost1: share(a1),
    atMost1_5: share(a15),
    atMost2: share(a2),
    atMost3: share(a3),
    stairShare: share(stairs),
    turnsPer100: sum > 0 ? (Math.max(0, n - 1) / sum) * 100 : 0,
  };
}

export interface BuildStage {
  /** Share of the line length drawn (0…1]. */
  readonly progress: number;
  /** Area of the drawn part's bounding box, as a share of the canvas. */
  readonly boxShare: number;
  /** Farthest the drawn part reaches from the start point, in canvas diagonals. */
  readonly reach: number;
  /**
   * Outline of the covered region (lattice cells of one spacing touched by the
   * drawn part) relative to a square of the same area: 1 = compact blob,
   * larger = branched / snaking.
   */
  readonly spread: number;
  /** Segment statistics of the part drawn since the previous stage. */
  readonly segments: SegmentStats;
}

/**
 * How the line builds up when it is drawn from start to end ("animation"):
 * for each progress value the drawn prefix is described. Geometry only; works
 * on any polyline (the stages end at the last point within the progress).
 */
export function buildStages(coords: ArrayLike<number>, size: { readonly width: number; readonly height: number }, spacing: number, progress: readonly number[]): BuildStage[] {
  const n = coords.length >> 1;
  const along = new Float64Array(n);
  for (let i = 1; i < n; i++) along[i] = along[i - 1]! + Math.hypot(coords[i * 2]! - coords[i * 2 - 2]!, coords[i * 2 + 1]! - coords[i * 2 - 1]!);
  const total = along[n - 1] ?? 0;
  const cols = Math.max(1, Math.ceil(size.width / spacing)), rows = Math.max(1, Math.ceil(size.height / spacing));
  const cell = new Uint8Array(cols * rows);
  let area = 0, edges = 0;
  const mark = (x: number, y: number) => {
    const cx = Math.min(cols - 1, Math.max(0, Math.floor(x / spacing))), cy = Math.min(rows - 1, Math.max(0, Math.floor(y / spacing)));
    const k = cy * cols + cx;
    if (cell[k]) return;
    cell[k] = 1;
    area++;
    // Outline: +4 for the new cell, −2 for every covered neighbour.
    edges += 4;
    if (cx > 0 && cell[k - 1]) edges -= 2;
    if (cx + 1 < cols && cell[k + 1]) edges -= 2;
    if (cy > 0 && cell[k - cols]) edges -= 2;
    if (cy + 1 < rows && cell[k + cols]) edges -= 2;
  };
  const x0 = coords[0] ?? 0, y0 = coords[1] ?? 0;
  const diagonal = Math.hypot(size.width, size.height);
  let minX = x0, maxX = x0, minY = y0, maxY = y0, reach = 0;
  const out: BuildStage[] = [];
  let i = 0, from = 0;
  mark(x0, y0);
  for (const p of [...progress].sort((a, b) => a - b)) {
    const limit = p * total;
    while (i + 1 < n && along[i + 1]! <= limit + 1e-9) {
      const ax = coords[i * 2]!, ay = coords[i * 2 + 1]!;
      i++;
      const x = coords[i * 2]!, y = coords[i * 2 + 1]!;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      reach = Math.max(reach, Math.hypot(x - x0, y - y0));
      // Every cell the segment passes (steps of half a cell).
      const steps = Math.max(1, Math.ceil((2 * Math.hypot(x - ax, y - ay)) / spacing));
      for (let t = 1; t <= steps; t++) mark(ax + ((x - ax) * t) / steps, ay + ((y - ay) * t) / steps);
    }
    out.push({
      progress: p,
      boxShare: ((maxX - minX) * (maxY - minY)) / (size.width * size.height),
      reach: reach / diagonal,
      spread: area > 0 ? edges / (4 * Math.sqrt(area)) : 0,
      segments: segmentStats(Array.prototype.slice.call(coords, from * 2, i * 2 + 2) as number[], spacing),
    });
    from = i;
  }
  return out;
}
