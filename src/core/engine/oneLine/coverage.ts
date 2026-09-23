import type { OneLinePath, ScalarField } from '../../models';

export type CoverageState = 'untouched' | 'partial' | 'sufficient';

/**
 * How much line an area received compared to how much it should receive.
 * Cells of a coarse grid; `target` is the cell's share of total demand times
 * the actual path length, `deposited` the path length drawn inside the cell.
 */
export interface CoverageReport {
  readonly cols: number;
  readonly rows: number;
  readonly target: Float64Array;
  readonly deposited: Float64Array;
  readonly states: readonly CoverageState[];
  readonly counts: Readonly<Record<CoverageState, number>>;
  /** Share of total demand lying in sufficiently covered cells (0..1). */
  readonly demandCovered: number;
  /** Pearson correlation between target and deposited line per cell (−1..1). */
  readonly correlation: number;
}

/** Deposited/target ratio from which a cell counts as sufficiently covered. */
export const SUFFICIENT_COVERAGE_RATIO = 0.5;

/**
 * Measures coverage of `path` against a demand field that spans the same
 * canvas (the demand grid is scaled to the path bounds).
 */
export function measureCoverage(path: OneLinePath, demand: ScalarField, cellsOnLongEdge: number): CoverageReport {
  const { width: W, height: H } = path.bounds;
  const cell = Math.max(W, H) / Math.max(1, cellsOnLongEdge);
  const cols = Math.max(1, Math.ceil(W / cell));
  const rows = Math.max(1, Math.ceil(H / cell));
  const cellIndex = (x: number, y: number) =>
    Math.min(rows - 1, Math.max(0, Math.floor(y / cell))) * cols + Math.min(cols - 1, Math.max(0, Math.floor(x / cell)));

  const deposited = new Float64Array(cols * rows);
  const c = path.coords;
  let total = 0;
  for (let i = 2; i < c.length; i += 2) {
    const x0 = c[i - 2]!, y0 = c[i - 1]!, x1 = c[i]!, y1 = c[i + 1]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    total += len;
    // Split long segments so their length lands in the cells they cross.
    const pieces = Math.max(1, Math.ceil(len / (cell / 2)));
    for (let s = 0; s < pieces; s++) {
      const t = (s + 0.5) / pieces;
      deposited[cellIndex(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)]! += len / pieces;
    }
  }

  const demandMass = new Float64Array(cols * rows);
  let demandTotal = 0;
  for (let y = 0; y < demand.height; y++) {
    for (let x = 0; x < demand.width; x++) {
      const v = demand.data[y * demand.width + x]!;
      demandMass[cellIndex(((x + 0.5) / demand.width) * W, ((y + 0.5) / demand.height) * H)]! += v;
      demandTotal += v;
    }
  }
  const target = demandMass.map((m) => (demandTotal > 0 ? (m / demandTotal) * total : 0));

  const states: CoverageState[] = [];
  const counts = { untouched: 0, partial: 0, sufficient: 0 };
  let covered = 0;
  for (let i = 0; i < target.length; i++) {
    const state: CoverageState =
      deposited[i] === 0 ? 'untouched' : deposited[i]! >= SUFFICIENT_COVERAGE_RATIO * target[i]! ? 'sufficient' : 'partial';
    states.push(state);
    counts[state]++;
    if (state === 'sufficient') covered += demandMass[i]!;
  }

  return {
    cols,
    rows,
    target,
    deposited,
    states,
    counts,
    demandCovered: demandTotal > 0 ? covered / demandTotal : 1,
    correlation: pearson(target, deposited),
  };
}

function pearson(a: Float64Array, b: Float64Array): number {
  const n = a.length;
  if (n < 2) return 1;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma, db = b[i]! - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 1;
}
