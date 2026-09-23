/**
 * Uniform bucket grid over points (CSR layout) for nearest-neighbour queries.
 * Points are given as separate x/y arrays in a common coordinate space.
 */
export interface PointGrid {
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  /** Start offset of each cell in `items` (length cols·rows + 1). */
  readonly starts: Int32Array;
  readonly items: Int32Array;
}

export function buildPointGrid(xs: Float64Array, ys: Float64Array, width: number, height: number, cellSize: number): PointGrid {
  const size = Math.max(cellSize, 1e-6);
  const cols = Math.max(1, Math.ceil(width / size));
  const rows = Math.max(1, Math.ceil(height / size));
  const n = xs.length;
  const cellOf = new Int32Array(n);
  const counts = new Int32Array(cols * rows + 1);
  for (let i = 0; i < n; i++) {
    const cx = Math.min(cols - 1, Math.max(0, Math.floor(xs[i]! / size)));
    const cy = Math.min(rows - 1, Math.max(0, Math.floor(ys[i]! / size)));
    const c = cy * cols + cx;
    cellOf[i] = c;
    counts[c + 1]!++;
  }
  for (let c = 0; c < cols * rows; c++) counts[c + 1]! += counts[c]!;
  const starts = counts;
  const fill = starts.slice(0, cols * rows);
  const items = new Int32Array(n);
  for (let i = 0; i < n; i++) items[fill[cellOf[i]!]!++] = i;
  return { cellSize: size, cols, rows, starts, items };
}

/** Calls `visit` for every in-bounds cell on the square ring at distance r around (cx, cy). */
export function forEachRingCell(cx: number, cy: number, r: number, cols: number, rows: number, visit: (cell: number) => void): void {
  if (r === 0) {
    visit(cy * cols + cx);
    return;
  }
  const x0 = cx - r, x1 = cx + r, y0 = cy - r, y1 = cy + r;
  for (let gx = Math.max(0, x0); gx <= Math.min(cols - 1, x1); gx++) {
    if (y0 >= 0) visit(y0 * cols + gx);
    if (y1 < rows) visit(y1 * cols + gx);
  }
  for (let gy = Math.max(0, y0 + 1); gy <= Math.min(rows - 1, y1 - 1); gy++) {
    if (x0 >= 0) visit(gy * cols + x0);
    if (x1 < cols) visit(gy * cols + x1);
  }
}

/**
 * Index of the nearest point to (x, y) among points accepted by `accept`,
 * searching rings of cells outward. `hint` (a known candidate) prunes the search.
 * Returns -1 if no point is accepted.
 */
export function nearestPoint(
  grid: PointGrid,
  xs: Float64Array,
  ys: Float64Array,
  x: number,
  y: number,
  accept: ((index: number) => boolean) | null,
  hint = -1,
  cellHasCandidates: ((cell: number) => boolean) | null = null,
): number {
  const { cellSize, cols, rows, starts, items } = grid;
  const cx = Math.min(cols - 1, Math.max(0, Math.floor(x / cellSize)));
  const cy = Math.min(rows - 1, Math.max(0, Math.floor(y / cellSize)));
  let best = -1;
  let bestD = Infinity;
  if (hint >= 0 && (!accept || accept(hint))) {
    best = hint;
    bestD = (xs[hint]! - x) ** 2 + (ys[hint]! - y) ** 2;
  }
  const visit = (cell: number) => {
    if (cellHasCandidates && !cellHasCandidates(cell)) return;
    for (let k = starts[cell]!; k < starts[cell + 1]!; k++) {
      const i = items[k]!;
      if (accept && !accept(i)) continue;
      const d = (xs[i]! - x) ** 2 + (ys[i]! - y) ** 2;
      if (d < bestD || (d === bestD && i < best)) {
        bestD = d;
        best = i;
      }
    }
  };
  const maxRing = Math.max(cols, rows);
  for (let r = 0; r <= maxRing; r++) {
    const ringMin = (r - 1) * cellSize;
    if (ringMin > 0 && ringMin * ringMin > bestD) break;
    forEachRingCell(cx, cy, r, cols, rows, visit);
  }
  return best;
}

/** k nearest neighbours of every point (excluding itself), sorted by distance, -1 padded. */
export function kNearestNeighbors(grid: PointGrid, xs: Float64Array, ys: Float64Array, k: number): Int32Array {
  const n = xs.length;
  const out = new Int32Array(n * k).fill(-1);
  const bestD = new Float64Array(k);
  const bestI = new Int32Array(k);
  const { cellSize, cols, rows, starts, items } = grid;
  for (let i = 0; i < n; i++) {
    bestD.fill(Infinity);
    bestI.fill(-1);
    const x = xs[i]!, y = ys[i]!;
    const cx = Math.min(cols - 1, Math.max(0, Math.floor(x / cellSize)));
    const cy = Math.min(rows - 1, Math.max(0, Math.floor(y / cellSize)));
    const visit = (cell: number) => {
      for (let q = starts[cell]!; q < starts[cell + 1]!; q++) {
        const j = items[q]!;
        if (j === i) continue;
        const d = (xs[j]! - x) ** 2 + (ys[j]! - y) ** 2;
        if (d > bestD[k - 1]! || (d === bestD[k - 1] && j > bestI[k - 1]! && bestI[k - 1]! >= 0)) continue;
        // insertion into the sorted top-k (ties broken by index for determinism)
        let s = k - 1;
        while (s > 0 && (bestD[s - 1]! > d || (bestD[s - 1] === d && bestI[s - 1]! > j))) {
          bestD[s] = bestD[s - 1]!;
          bestI[s] = bestI[s - 1]!;
          s--;
        }
        bestD[s] = d;
        bestI[s] = j;
      }
    };
    const maxRing = Math.max(cols, rows);
    for (let r = 0; r <= maxRing; r++) {
      const ringMin = (r - 1) * cellSize;
      if (ringMin > 0 && ringMin * ringMin > bestD[k - 1]!) break;
      forEachRingCell(cx, cy, r, cols, rows, visit);
    }
    out.set(bestI, i * k);
  }
  return out;
}
