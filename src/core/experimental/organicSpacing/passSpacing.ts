import type { OneLinePath, ScalarField } from '../../models';

/**
 * Phase 15.5: distance from every point of a line to the nearest OTHER pass
 * of the same line, for free-form (organic) paths. Descriptive only.
 *
 * All lengths are in px at a long edge of MEASURE_LONG_EDGE (800 px, the unit
 * of the variable-width prototypes: "3 px" means the same fraction of the
 * picture as the Free Orthogonal 3 px spacing).
 *
 * "Other pass": a segment whose position along the line differs by more than
 * 2 × its distance + 1 px, so a point's own neighbourhood and the inside of a
 * tight turn do not count, but a pass coming back after a turn does.
 */
export const MEASURE_LONG_EDGE = 800;
/** Samples along the line, px. */
const STEP = 0.5;
/** Farther than this counts as "no neighbour" (open area), px. */
const SEARCH = 16;
const CELL = 4;

export interface Distribution {
  readonly mean: number;
  readonly min: number;
  readonly p05: number;
  readonly p10: number;
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
  readonly p95: number;
  readonly samples: number;
}

export interface PassSpacing {
  /** All samples with a neighbour within SEARCH px. */
  readonly all: Distribution;
  /** By the original's lightness at the sample (L* < 0.35 / 0.35–0.7 / ≥ 0.7), when a lightness field is given. */
  readonly dark: Distribution | null;
  readonly mid: Distribution | null;
  readonly light: Distribution | null;
  /** Share of samples without a neighbour within SEARCH px. */
  readonly openShare: number;
  /** Share of samples closer than the line width to their neighbour (the lines touch: merged). */
  readonly touchingShare: number;
  /** Share of samples closer than 2 line widths (very dense). */
  readonly denseShare: number;
  /** Histogram of the distance, 0.5 px bins from 0 to SEARCH. */
  readonly histogram: Uint32Array;
  /** Line length, px at MEASURE_LONG_EDGE. */
  readonly length: number;
}

function distribution(values: number[]): Distribution {
  const n = values.length;
  if (n === 0) return { mean: 0, min: 0, p05: 0, p10: 0, p25: 0, median: 0, p75: 0, p95: 0, samples: 0 };
  const s = Float64Array.from(values).sort();
  const q = (p: number) => s[Math.round(p * (n - 1))]!;
  let sum = 0;
  for (const v of s) sum += v;
  return { mean: sum / n, min: s[0]!, p05: q(0.05), p10: q(0.1), p25: q(0.25), median: q(0.5), p75: q(0.75), p95: q(0.95), samples: n };
}

export function measurePassSpacing(path: Pick<OneLinePath, 'coords' | 'bounds'>, options: { readonly lineWidth?: number; readonly lightness?: ScalarField } = {}): PassSpacing {
  const { width: W, height: H } = path.bounds;
  const k = MEASURE_LONG_EDGE / Math.max(W, H);
  const src = path.coords;
  const n = src.length >> 1;
  const c = new Float64Array(n * 2);
  for (let i = 0; i < n * 2; i++) c[i] = src[i]! * k;
  const along = new Float64Array(n);
  for (let i = 1; i < n; i++) along[i] = along[i - 1]! + Math.hypot(c[i * 2]! - c[i * 2 - 2]!, c[i * 2 + 1]! - c[i * 2 - 1]!);
  const w = W * k, h = H * k;
  const cols = Math.max(1, Math.ceil(w / CELL) + 1), rows = Math.max(1, Math.ceil(h / CELL) + 1);
  const buckets: number[][] = Array.from({ length: cols * rows }, () => []);
  const cellOf = (v: number, count: number) => Math.min(count - 1, Math.max(0, Math.floor(v / CELL)));
  for (let j = 0; j < n - 1; j++) {
    const x0 = cellOf(Math.min(c[j * 2]!, c[j * 2 + 2]!), cols), x1 = cellOf(Math.max(c[j * 2]!, c[j * 2 + 2]!), cols);
    const y0 = cellOf(Math.min(c[j * 2 + 1]!, c[j * 2 + 3]!), rows), y1 = cellOf(Math.max(c[j * 2 + 1]!, c[j * 2 + 3]!), rows);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) buckets[y * cols + x]!.push(j);
  }
  const lineWidth = options.lineWidth ?? 0.8;
  const L = options.lightness;
  const lightAt = (x: number, y: number) =>
    L ? L.data[Math.min(L.height - 1, Math.max(0, Math.floor((y / h) * L.height))) * L.width + Math.min(L.width - 1, Math.max(0, Math.floor((x / w) * L.width)))]! : 0.5;
  const all: number[] = [], dark: number[] = [], mid: number[] = [], light: number[] = [];
  const histogram = new Uint32Array(Math.ceil(SEARCH / 0.5));
  let open = 0, touching = 0, dense = 0, total = 0;
  const seen = new Int32Array(Math.max(1, n - 1)).fill(-1);
  let query = 0;
  const reach = Math.ceil(SEARCH / CELL);
  for (let i = 0; i < n - 1; i++) {
    const len = along[i + 1]! - along[i]!;
    const parts = Math.max(1, Math.ceil(len / STEP));
    for (let p = 0; p < parts; p++) {
      const t = p / parts;
      const qx = c[i * 2]! + (c[i * 2 + 2]! - c[i * 2]!) * t, qy = c[i * 2 + 1]! + (c[i * 2 + 3]! - c[i * 2 + 1]!) * t;
      const qa = along[i]! + len * t;
      query++;
      total++;
      let best = SEARCH;
      let found = false;
      const cx = cellOf(qx, cols), cy = cellOf(qy, rows);
      for (let y = Math.max(0, cy - reach); y <= Math.min(rows - 1, cy + reach); y++) {
        for (let x = Math.max(0, cx - reach); x <= Math.min(cols - 1, cx + reach); x++) {
          for (const j of buckets[y * cols + x]!) {
            if (seen[j] === query) continue;
            seen[j] = query;
            const ax = c[j * 2]!, ay = c[j * 2 + 1]!, dx = c[j * 2 + 2]! - ax, dy = c[j * 2 + 3]! - ay;
            const l2 = dx * dx + dy * dy;
            const u = l2 > 0 ? Math.min(1, Math.max(0, ((qx - ax) * dx + (qy - ay) * dy) / l2)) : 0;
            const d = Math.hypot(qx - ax - dx * u, qy - ay - dy * u);
            if (d >= best) continue;
            const gap = Math.abs(along[j]! + Math.sqrt(l2) * u - qa);
            if (gap <= 2 * d + 1) continue;
            best = d;
            found = true;
          }
        }
      }
      if (!found) {
        open++;
        continue;
      }
      all.push(best);
      histogram[Math.min(histogram.length - 1, Math.floor(best / 0.5))]!++;
      if (best < lineWidth) touching++;
      if (best < 2 * lineWidth) dense++;
      if (L) {
        const l = lightAt(qx, qy);
        (l < 0.35 ? dark : l < 0.7 ? mid : light).push(best);
      }
    }
  }
  const t = Math.max(1, total);
  return {
    all: distribution(all),
    dark: L ? distribution(dark) : null,
    mid: L ? distribution(mid) : null,
    light: L ? distribution(light) : null,
    openShare: open / t,
    touchingShare: touching / t,
    denseShare: dense / t,
    histogram,
    length: along[n - 1] ?? 0,
  };
}
