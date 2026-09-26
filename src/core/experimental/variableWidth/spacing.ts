import type { VariableWidthLine } from './generate';

/**
 * Phase 15.2: spacing and width statistics that work for EVERY route shape
 * (straight, arcs, curves, spiral). Descriptive only, no quality verdict.
 *
 * Spacing at a point = distance to the nearest OTHER pass of the line: the
 * nearest segment whose position along the line is more than `window` away
 * (so the point's own neighbourhood and the inside of a U-turn do not count).
 * Measured every half spacing along the whole line, including the turns.
 */
export interface Stats {
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly std: number;
  /** 5th / 95th percentile (robust range without single turn points). */
  readonly p05: number;
  readonly p95: number;
  readonly samples: number;
}

export interface LineGeometry {
  /** Distance to the neighbouring pass, working-grid px (compare with the spacing parameter). */
  readonly spacing: Stats;
  /** Samples with no other pass within 3 spacings (e.g. none; the canvas border is not a pass). */
  readonly unmatched: number;
  /** Centre line length, working-grid px. */
  readonly length: number;
  readonly points: number;
  /** Line width along the line, working-grid px. */
  readonly width: Stats;
  /** Share of the line where it touches or overlaps its neighbour: (w + w_neighbour)/2 ≥ distance. */
  readonly overlapShare: number;
  /** Share of very thin / very thick line (lowest / highest 5 % of the allowed width range). */
  readonly thinShare: number;
  readonly thickShare: number;
}

function stats(values: Float64Array): Stats {
  const n = values.length;
  if (n === 0) return { mean: 0, min: 0, max: 0, std: 0, p05: 0, p95: 0, samples: 0 };
  let sum = 0, sq = 0, min = Infinity, max = -Infinity;
  for (const v of values) {
    sum += v;
    sq += v * v;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const sorted = Float64Array.from(values).sort();
  const mean = sum / n;
  return {
    mean,
    min,
    max,
    std: Math.sqrt(Math.max(0, sq / n - mean * mean)),
    p05: sorted[Math.floor(0.05 * (n - 1))]!,
    p95: sorted[Math.ceil(0.95 * (n - 1))]!,
    samples: n,
  };
}

/** Along-line exclusion window in spacings: longer than a U-turn of the reference meander (π/2 spacings). */
const WINDOW = 1.6;
const SEARCH = 3;

export function measureLineGeometry(line: VariableWidthLine): LineGeometry {
  const c = line.path.coords;
  const w = line.widths;
  const n = c.length >> 1;
  const k = line.spacing / line.parameters.spacing; // image px per working px
  const s = line.spacing;
  const segs = n - 1;
  const along = new Float64Array(n);
  for (let i = 1; i < n; i++) along[i] = along[i - 1]! + Math.hypot(c[i * 2]! - c[i * 2 - 2]!, c[i * 2 + 1]! - c[i * 2 - 1]!);

  // Uniform grid of segments.
  const cell = 1.5 * s;
  const cols = Math.max(1, Math.ceil(line.path.bounds.width / cell) + 1);
  const rows = Math.max(1, Math.ceil(line.path.bounds.height / cell) + 1);
  const buckets: number[][] = Array.from({ length: cols * rows }, () => []);
  const cellOf = (v: number, count: number) => Math.min(count - 1, Math.max(0, Math.floor(v / cell)));
  for (let j = 0; j < segs; j++) {
    const x0 = cellOf(Math.min(c[j * 2]!, c[j * 2 + 2]!), cols), x1 = cellOf(Math.max(c[j * 2]!, c[j * 2 + 2]!), cols);
    const y0 = cellOf(Math.min(c[j * 2 + 1]!, c[j * 2 + 3]!), rows), y1 = cellOf(Math.max(c[j * 2 + 1]!, c[j * 2 + 3]!), rows);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) buckets[y * cols + x]!.push(j);
  }

  const distances: number[] = [];
  const widthsAt: number[] = [];
  let unmatched = 0, overlap = 0;
  const seen = new Int32Array(segs).fill(-1);
  let query = 0;
  const reach = Math.ceil((SEARCH * s) / cell);
  for (let i = 0; i < segs; i++) {
    const len = along[i + 1]! - along[i]!;
    const parts = Math.max(1, Math.ceil(len / (s / 2)));
    for (let p = 0; p < parts; p++) {
      const t = p / parts;
      const qx = c[i * 2]! + (c[i * 2 + 2]! - c[i * 2]!) * t, qy = c[i * 2 + 1]! + (c[i * 2 + 3]! - c[i * 2 + 1]!) * t;
      const qa = along[i]! + len * t;
      const qw = w[i]! + (w[i + 1]! - w[i]!) * t;
      query++;
      let best = SEARCH * s, bestW = 0, found = false;
      const cx = cellOf(qx, cols), cy = cellOf(qy, rows);
      for (let y = Math.max(0, cy - reach); y <= Math.min(rows - 1, cy + reach); y++) {
        for (let x = Math.max(0, cx - reach); x <= Math.min(cols - 1, cx + reach); x++) {
          for (const j of buckets[y * cols + x]!) {
            if (seen[j] === query) continue;
            seen[j] = query;
            // Skip the own neighbourhood along the line.
            if (along[j + 1]! > qa - WINDOW * s && along[j]! < qa + WINDOW * s) continue;
            const ax = c[j * 2]!, ay = c[j * 2 + 1]!, bx = c[j * 2 + 2]!, by = c[j * 2 + 3]!;
            const dx = bx - ax, dy = by - ay;
            const l2 = dx * dx + dy * dy;
            const u = l2 > 0 ? Math.min(1, Math.max(0, ((qx - ax) * dx + (qy - ay) * dy) / l2)) : 0;
            const d = Math.hypot(qx - ax - dx * u, qy - ay - dy * u);
            if (d < best) {
              best = d;
              bestW = w[j]! + (w[j + 1]! - w[j]!) * u;
              found = true;
            }
          }
        }
      }
      widthsAt.push(qw / k);
      if (!found) {
        unmatched++;
        continue;
      }
      distances.push(best / k);
      if ((qw + bestW) / 2 >= best) overlap++;
    }
  }

  const widthStats = stats(Float64Array.from(widthsAt));
  const lo = line.parameters.minWidth, hi = line.parameters.maxWidth;
  const band = 0.05 * (hi - lo);
  let thin = 0, thick = 0;
  for (const v of widthsAt) {
    if (v <= lo + band) thin++;
    if (v >= hi - band) thick++;
  }
  const total = Math.max(1, widthsAt.length);
  return {
    spacing: stats(Float64Array.from(distances)),
    unmatched,
    length: along[n - 1]! / k,
    points: n,
    width: widthStats,
    overlapShare: distances.length ? overlap / distances.length : 0,
    thinShare: thin / total,
    thickShare: thick / total,
  };
}
