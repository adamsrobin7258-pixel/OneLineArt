/**
 * Local repair of a CORNER ROUTE (Phase 14.2): a polyline through the tour
 * points where every connection i (point i → point i+1) is drawn either
 * straight or via one corner, chosen from two options (choice 0 / 1). Used by
 * the Geometric (45°/90°) and Orthogonal (L-shaped) line shapes only; the
 * Organic style draws its connections straight and never comes here.
 *
 * Why: the tour is optimized on STRAIGHT connections (2-opt removes their
 * crossings), but the shapes draw corner paths. Two connections that do not
 * cross as straight lines can cross as corner paths when their bounding
 * boxes overlap, and a corner may send the line straight back over the leg
 * before it (a 180° spike). Both choices of a connection have the same drawn
 * length, so switching the corner changes neither the points nor the length —
 * only which side of its box the connection takes.
 */

/** Corner of connection i for a choice, or null when the connection is drawn straight. */
export type CornerOf = (i: number, choice: number) => readonly [number, number] | null;

/** Unit directions below this dot product count as a reversal (the line running straight back). */
const REVERSAL_DOT = -1 + 1e-9;

/** The drawn polyline: points in order, with the chosen corner (if any) between each pair. */
export function buildCornerRoute(points: Float64Array, choices: Uint8Array, cornerOf: CornerOf): Float64Array {
  const n = points.length >> 1;
  if (n < 2) return points;
  const out = new Float64Array((2 * n - 1) * 2);
  let o = 0;
  out[o++] = points[0]!;
  out[o++] = points[1]!;
  for (let i = 0; i < n - 1; i++) {
    const corner = cornerOf(i, choices[i]!);
    if (corner) {
      out[o++] = corner[0];
      out[o++] = corner[1];
    }
    out[o++] = points[i * 2 + 2]!;
    out[o++] = points[i * 2 + 3]!;
  }
  return out.subarray(0, o);
}

/** Whether direction (bx, by) runs straight back along (ax, ay). */
export function isReversal(ax: number, ay: number, bx: number, by: number): boolean {
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  return la > 0 && lb > 0 && (ax * bx + ay * by) / (la * lb) < REVERSAL_DOT;
}

/** Proper crossing of two segments (touching endpoints and collinear overlaps do not count). */
function crosses(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  if (!((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))) return false;
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return (d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0);
}

/**
 * Whether connection i (choice ci) and the next connection (choice cj)
 * properly cross each other — a small loop at their shared point. Depends
 * only on the two choices, so a Viterbi over the choices can avoid it.
 */
export function neighboursCross(points: Float64Array, cornerOf: CornerOf, i: number, ci: number, cj: number): boolean {
  const a = cornerOf(i, ci), b = cornerOf(i + 1, cj);
  if (!a && !b) return false;
  const p0x = points[i * 2]!, p0y = points[i * 2 + 1]!, p1x = points[i * 2 + 2]!, p1y = points[i * 2 + 3]!, p2x = points[i * 2 + 4]!, p2y = points[i * 2 + 5]!;
  // Legs of i: p0→(a)→p1; legs of i+1: p1→(b)→p2. Only non-touching pairs can cross properly.
  const first = a ? [p0x, p0y, a[0], a[1]] : [p0x, p0y, p1x, p1y];
  const second = b ? [b[0], b[1], p2x, p2y] : [p1x, p1y, p2x, p2y];
  if (crosses(first[0]!, first[1]!, first[2]!, first[3]!, second[0]!, second[1]!, second[2]!, second[3]!)) return true;
  if (a && crosses(a[0], a[1], p1x, p1y, second[0]!, second[1]!, second[2]!, second[3]!)) return true;
  if (b && crosses(first[0]!, first[1]!, first[2]!, first[3]!, p1x, p1y, b[0], b[1])) return true;
  return false;
}

/**
 * Cost of two neighbouring connections crossing each other, in the corner
 * choices' unit (90° turns): half a reversal (8). A crossing is a conflict of
 * the line with itself, but a lesser one than running straight back over it;
 * it outweighs a few ordinary turns, since both corners are equally long.
 */
export const NEIGHBOUR_CROSSING_COST = 4;

/**
 * Segments in a uniform grid (each in every cell its bounding box touches),
 * with removal, so crossing checks stay local: a query only looks at the
 * cells of the query segment. Deterministic (arrays, insertion order).
 */
export class SegmentGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly coords: number[] = [];
  private readonly alive: boolean[] = [];
  private readonly seen: number[] = [];
  private stamp = 0;
  private readonly cols: number;

  constructor(
    private readonly minX: number,
    private readonly minY: number,
    maxX: number,
    private readonly cell: number,
  ) {
    this.cols = Math.max(1, Math.floor((maxX - minX) / cell) + 1);
  }

  /** Grid for the segments of a polyline area: cell ≈ twice the mean segment length. */
  static around(coords: Float64Array): SegmentGrid {
    const n = coords.length >> 1;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, length = 0;
    for (let i = 0; i < n; i++) {
      const x = coords[i * 2]!, y = coords[i * 2 + 1]!;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      if (i > 0) length += Math.hypot(x - coords[i * 2 - 2]!, y - coords[i * 2 - 1]!);
    }
    const cell = Math.max(1e-6, (2 * length) / Math.max(1, n - 1));
    return new SegmentGrid(minX, minY, maxX, cell);
  }

  private range(x1: number, y1: number, x2: number, y2: number): [number, number, number, number] {
    const c = this.cell;
    return [
      Math.floor((Math.min(x1, x2) - this.minX) / c),
      Math.floor((Math.min(y1, y2) - this.minY) / c),
      Math.floor((Math.max(x1, x2) - this.minX) / c),
      Math.floor((Math.max(y1, y2) - this.minY) / c),
    ];
  }

  add(x1: number, y1: number, x2: number, y2: number): number {
    const id = this.alive.length;
    this.coords.push(x1, y1, x2, y2);
    this.alive.push(true);
    this.seen.push(0);
    const [c0, r0, c1, r1] = this.range(x1, y1, x2, y2);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const key = r * this.cols + c;
        let list = this.cells.get(key);
        if (!list) this.cells.set(key, (list = []));
        list.push(id);
      }
    }
    return id;
  }

  remove(id: number): void {
    this.alive[id] = false;
  }

  /** Number of live segments (other than `exclude`) that the segment properly crosses. */
  count(x1: number, y1: number, x2: number, y2: number, exclude: readonly number[] = []): number {
    const stamp = ++this.stamp;
    for (const id of exclude) this.seen[id] = stamp;
    const [c0, r0, c1, r1] = this.range(x1, y1, x2, y2);
    let n = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const list = this.cells.get(r * this.cols + c);
        if (!list) continue;
        for (const id of list) {
          if (!this.alive[id] || this.seen[id] === stamp) continue;
          this.seen[id] = stamp;
          const k = id * 4;
          if (crosses(x1, y1, x2, y2, this.coords[k]!, this.coords[k + 1]!, this.coords[k + 2]!, this.coords[k + 3]!)) n++;
        }
      }
    }
    return n;
  }
}

/** Passes over the connections; each pass only switches corners that remove crossings. */
const UNCROSS_PASSES = 3;

/**
 * Switches the corner of connections whose corner path crosses other parts
 * of the line, when the other corner crosses fewer and adds no reversal at
 * either end. Points, their order and the drawn length stay the same (both
 * corners of a connection are equally long), so coverage and tone
 * distribution are untouched. Local: a connection is only compared with the
 * segments in the grid cells around it. Returns the number of switches;
 * `choices` is updated in place. Deterministic (fixed order, fixed passes).
 */
export function uncrossCorners(points: Float64Array, choices: Uint8Array, cornerOf: CornerOf): number {
  const n = points.length >> 1;
  const m = n - 1;
  if (m < 2) return 0;
  const grid = SegmentGrid.around(points);
  const px = (k: number) => points[k * 2]!;
  const py = (k: number) => points[k * 2 + 1]!;
  const legIds: number[][] = new Array(m);
  const addLegs = (i: number, choice: number): number[] => {
    const corner = cornerOf(i, choice);
    if (!corner) return [grid.add(px(i), py(i), px(i + 1), py(i + 1))];
    return [grid.add(px(i), py(i), corner[0], corner[1]), grid.add(corner[0], corner[1], px(i + 1), py(i + 1))];
  };
  for (let i = 0; i < m; i++) legIds[i] = addLegs(i, choices[i]!);

  const crossingsOf = (i: number, choice: number, exclude: readonly number[]): number => {
    const corner = cornerOf(i, choice);
    if (!corner) return grid.count(px(i), py(i), px(i + 1), py(i + 1), exclude);
    return grid.count(px(i), py(i), corner[0], corner[1], exclude) + grid.count(corner[0], corner[1], px(i + 1), py(i + 1), exclude);
  };
  /** First / last leg direction of connection i for a choice. */
  const firstLeg = (i: number, choice: number): [number, number] => {
    const corner = cornerOf(i, choice);
    const tx = corner ? corner[0] : px(i + 1), ty = corner ? corner[1] : py(i + 1);
    return [tx - px(i), ty - py(i)];
  };
  const lastLeg = (i: number, choice: number): [number, number] => {
    const corner = cornerOf(i, choice);
    const fx = corner ? corner[0] : px(i), fy = corner ? corner[1] : py(i);
    return [px(i + 1) - fx, py(i + 1) - fy];
  };
  /** Reversals at both ends of connection i if it takes `choice` (neighbours keep theirs). */
  const reversalsAround = (i: number, choice: number): number => {
    let r = 0;
    if (i > 0) {
      const a = lastLeg(i - 1, choices[i - 1]!), b = firstLeg(i, choice);
      if (isReversal(a[0], a[1], b[0], b[1])) r++;
    }
    if (i < m - 1) {
      const a = lastLeg(i, choice), b = firstLeg(i + 1, choices[i + 1]!);
      if (isReversal(a[0], a[1], b[0], b[1])) r++;
    }
    return r;
  };

  let switches = 0;
  for (let pass = 0; pass < UNCROSS_PASSES; pass++) {
    let changed = false;
    for (let i = 0; i < m; i++) {
      const current = choices[i]!;
      const other = 1 - current;
      // A straight connection (no corner) has nothing to switch.
      if (!cornerOf(i, current) || !cornerOf(i, other)) continue;
      const own = legIds[i]!;
      const now = crossingsOf(i, current, own);
      if (now === 0) continue;
      const then = crossingsOf(i, other, own);
      if (then >= now || reversalsAround(i, other) > reversalsAround(i, current)) continue;
      for (const id of own) grid.remove(id);
      choices[i] = other;
      legIds[i] = addLegs(i, other);
      switches++;
      changed = true;
    }
    if (!changed) break;
  }
  return switches;
}
