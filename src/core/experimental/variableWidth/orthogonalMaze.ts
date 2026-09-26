import type { Size } from '../../models';
import { createRandom } from '../../utils';
import { meanderRows, type Route, type RouteOptions } from './routes';

/**
 * Phase 15.3 "Free Orthogonal": a labyrinth-like single line from horizontal
 * and vertical segments only, at a constant spacing.
 *
 * Construction (spanning-tree coverage, as used for robot lawn mowers):
 * 1. The canvas is divided into coarse cells of 2 × spacing; each holds a
 *    2 × 2 block of fine cells of 1 × spacing.
 * 2. A spanning tree connects all coarse cells (Kruskal on deterministic
 *    edge weights, see below).
 * 3. Every coarse cell starts as a small square loop through its four fine
 *    cell centres. Each tree edge merges the loops of its two cells into one
 *    (the two facing sides are replaced by two bridges). After all N − 1 tree
 *    edges there is exactly ONE closed loop through every fine cell centre:
 *    the line walks around the tree like a hand along the walls of a maze.
 * 4. The loop is opened at the fine cell nearest to the start point: the line
 *    starts there and ends one spacing next to it. Any start point works.
 *
 * Properties by construction: only horizontal/vertical segments, only 90°
 * turns, no self-crossing (a simple lattice loop), neighbouring passes exactly
 * one spacing apart, the whole canvas covered up to a border < 1 spacing.
 *
 * The labyrinth's character comes from the tree. Edge weights mix a slowly
 * varying preferred corridor direction (a smooth field of three long waves,
 * phases from the seed) with a seeded per-edge jitter: `order` = 1 gives long
 * corridors that bend with the field, 0 a uniformly random maze. Nothing here
 * depends on the image.
 */

export interface MazeOptions {
  /** Seed of the field phases and the jitter. */
  readonly seed: number;
  /** 0…1: share of the smooth direction field in the edge weights (the rest is jitter). */
  readonly order: number;
  /** Wavelength of the direction field in canvas long edges. */
  readonly scale: number;
}

export interface MazeRoute extends Route {
  readonly maze: {
    /** Coarse cells (tree nodes) and fine cells (loop points). */
    readonly coarseCells: number;
    readonly fineCells: number;
    /** Uncovered border on each side (px). */
    readonly marginX: number;
    readonly marginY: number;
  };
}

/** Deterministic hash of three integers → [0, 1). */
function hash01(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b ^ 0xc2b2ae35, 0x27d4eb2f) ^ Math.imul(c, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function find(parent: Int32Array, i: number): number {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]!]!;
    i = parent[i]!;
  }
  return i;
}

export function orthogonalMaze(size: Size, o: RouteOptions, m: MazeOptions): MazeRoute | (Route & { maze: null }) {
  const { width: W, height: H } = size;
  const s = o.spacing;
  const g = coarseGrid(size, s);
  if (!g) return { ...meanderRows(size, o), maze: null };
  const { cw, ch, marginX, marginY } = g;

  // Smooth direction field: angle of the preferred corridor direction at (x, y).
  const rng = createRandom(Math.floor(m.seed) >>> 0);
  const L = Math.max(W, H) * Math.max(0.05, m.scale);
  const waves = [0, 1, 2].map(() => ({ a: rng.range(0, Math.PI), phase: rng.range(0, 2 * Math.PI), weight: rng.range(0.6, 1) }));
  const field = (x: number, y: number) => {
    let v = 0;
    for (const w of waves) v += w.weight * Math.sin((2 * Math.PI * (x * Math.cos(w.a) + y * Math.sin(w.a))) / L + w.phase);
    return v; // ≈ −2.5…2.5
  };
  // Share of "horizontal" preference in [0, 1]: cos² of a slowly turning angle.
  const horizontal = (x: number, y: number) => Math.cos((Math.PI / 2) * (1 + Math.tanh(field(x, y)))) ** 2;
  const order = Math.min(1, Math.max(0, m.order));
  const seedInt = Math.floor(m.seed) | 0;

  // Kruskal over the coarse grid.
  const n = cw * ch;
  const edges: { a: number; b: number; w: number }[] = [];
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      const cx = marginX + (2 * i + 1) * s, cy = marginY + (2 * j + 1) * s;
      if (i + 1 < cw) {
        const p = horizontal(cx + s, cy);
        edges.push({ a: j * cw + i, b: j * cw + i + 1, w: order * (1 - p) + (1 - order) * hash01(i, j, seedInt * 2) });
      }
      if (j + 1 < ch) {
        const p = horizontal(cx, cy + s);
        edges.push({ a: j * cw + i, b: (j + 1) * cw + i, w: order * p + (1 - order) * hash01(i, j, seedInt * 2 + 1) });
      }
    }
  }
  // Stable order: weight, then index (deterministic ties).
  const index = edges.map((_, k) => k).sort((p, q) => edges[p]!.w - edges[q]!.w || p - q);
  const parent = Int32Array.from({ length: n }, (_, k) => k);
  // Accepted tree edges in acceptance order (the loop merges follow this order).
  const tree = new Int32Array((n - 1) * 2);
  let treeEdges = 0;
  for (const k of index) {
    const { a, b } = edges[k]!;
    const ra = find(parent, a), rb = find(parent, b);
    if (ra === rb) continue;
    parent[ra] = rb;
    tree[treeEdges * 2] = a;
    tree[treeEdges * 2 + 1] = b;
    treeEdges++;
    if (treeEdges === n - 1) break;
  }
  return treeLoop(size, o, { cw, ch, marginX, marginY }, tree.subarray(0, treeEdges * 2));
}

interface CoarseGrid {
  /** Coarse cells per row / column. */
  readonly cw: number;
  readonly ch: number;
  readonly marginX: number;
  readonly marginY: number;
}

/**
 * Coarse grid of 2 × spacing cells, centred on the canvas; null when fewer
 * than two cells fit.
 */
function coarseGrid(size: Size, s: number): CoarseGrid | null {
  const cw = Math.floor(size.width / (2 * s)), ch = Math.floor(size.height / (2 * s));
  if (cw < 1 || ch < 1 || cw * ch < 2) return null;
  return { cw, ch, marginX: (size.width - 2 * cw * s) / 2, marginY: (size.height - 2 * ch * s) / 2 };
}

/**
 * Steps 3 and 4: the lattice loop around a spanning tree of the coarse grid,
 * opened at the start point. `tree` holds the tree edges as pairs of coarse
 * cell indices (a < b, neighbours); the merges are applied in this order,
 * which fixes the walking direction deterministically.
 */
function treeLoop(size: Size, o: RouteOptions, g: CoarseGrid, tree: Int32Array): MazeRoute {
  const { width: W, height: H } = size;
  const s = o.spacing;
  const { cw, ch, marginX, marginY } = g;
  const n = cw * ch;
  const fw = 2 * cw, fh = 2 * ch;
  // Fine-loop links: for every fine node its two neighbours (−1 = unset).
  const link = new Int32Array(fw * fh * 2).fill(-1);
  const id = (fx: number, fy: number) => fy * fw + fx;
  // Every fine node has exactly two link slots (it lies on one loop).
  const connect = (p: number, q: number) => {
    link[p * 2 + (link[p * 2] === -1 ? 0 : 1)] = q;
    link[q * 2 + (link[q * 2] === -1 ? 0 : 1)] = p;
  };
  const disconnect = (p: number, q: number) => {
    for (const [u, v] of [[p, q], [q, p]] as const) {
      if (link[u * 2] === v) link[u * 2] = -1;
      else if (link[u * 2 + 1] === v) link[u * 2 + 1] = -1;
    }
  };
  // Initial square loops.
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      const a = id(2 * i, 2 * j), b = id(2 * i + 1, 2 * j), c = id(2 * i + 1, 2 * j + 1), d = id(2 * i, 2 * j + 1);
      connect(a, b);
      connect(b, c);
      connect(c, d);
      connect(d, a);
    }
  }
  const treeEdges = tree.length >> 1;
  for (let e = 0; e < treeEdges; e++) {
    const a = tree[e * 2]!, b = tree[e * 2 + 1]!;
    const ai = a % cw, aj = Math.floor(a / cw);
    if (b === a + 1 && b % cw !== 0) {
      // Horizontal: replace A's right side and B's left side by two bridges.
      const ar0 = id(2 * ai + 1, 2 * aj), ar1 = id(2 * ai + 1, 2 * aj + 1), bl0 = id(2 * ai + 2, 2 * aj), bl1 = id(2 * ai + 2, 2 * aj + 1);
      disconnect(ar0, ar1);
      disconnect(bl0, bl1);
      connect(ar0, bl0);
      connect(ar1, bl1);
    } else {
      // Vertical: replace A's bottom side and B's top side.
      const ab0 = id(2 * ai, 2 * aj + 1), ab1 = id(2 * ai + 1, 2 * aj + 1), bt0 = id(2 * ai, 2 * aj + 2), bt1 = id(2 * ai + 1, 2 * aj + 2);
      disconnect(ab0, ab1);
      disconnect(bt0, bt1);
      connect(ab0, bt0);
      connect(ab1, bt1);
    }
  }

  // Open the loop at the fine cell nearest to the start point and walk it.
  const px = (fx: number) => marginX + (fx + 0.5) * s;
  const py = (fy: number) => marginY + (fy + 0.5) * s;
  const sfx = Math.min(fw - 1, Math.max(0, Math.floor((o.start.x * W - marginX) / s)));
  const sfy = Math.min(fh - 1, Math.max(0, Math.floor((o.start.y * H - marginY) / s)));
  const start = id(sfx, sfy);
  const total = fw * fh;
  const walk = new Int32Array(total);
  // Walk the loop once, starting towards the first linked neighbour (deterministic).
  let prev = -1, cur = start;
  for (let k = 0; k < total; k++) {
    walk[k] = cur;
    const nextA = link[cur * 2]!, nextB = link[cur * 2 + 1]!;
    const next = nextA !== prev ? nextA : nextB;
    prev = cur;
    cur = next;
  }

  // Polyline sampled every ≤ step along each lattice edge.
  const sub = Math.max(1, Math.ceil(s / o.step));
  const coords = new Float64Array(((total - 1) * sub + 1) * 2);
  let c = 0;
  for (let k = 0; k < total; k++) {
    const node = walk[k]!;
    const x = px(node % fw), y = py(Math.floor(node / fw));
    if (k === 0) {
      coords[c++] = x;
      coords[c++] = y;
      continue;
    }
    const pnode = walk[k - 1]!;
    const x0 = px(pnode % fw), y0 = py(Math.floor(pnode / fw));
    for (let t = 1; t <= sub; t++) {
      coords[c++] = x0 + ((x - x0) * t) / sub;
      coords[c++] = y0 + ((y - y0) * t) / sub;
    }
  }
  return {
    coords: coords.subarray(0, c),
    frame: new Uint8Array(c >> 1),
    lines: treeEdges + 1,
    maze: { coarseCells: n, fineCells: total, marginX, marginY },
  };
}

/**
 * Phase 15.4 "Free Orthogonal – grown": the same lattice loop (steps 1, 3, 4
 * above, so the same guarantees), but the spanning tree GROWS like a maze
 * carved by hand instead of being assembled from random edges (Kruskal).
 *
 * Growing tree: a list of active cells starts at one seeded root cell. Each
 * step takes the newest active cell (share `run`, carves long winding
 * corridors) or a random active cell (branches), and carves into one of its
 * unvisited neighbours; a cell without unvisited neighbours leaves the list.
 * The direction is chosen by weights:
 * - `straight`: continuing the incoming direction is preferred (longer runs);
 * - `stairs`: turning straight back after a turn (the ┐└┐└ staircase: east,
 *   south, east …) is avoided;
 * - `hairpins`: turning the same way twice in a row (a U-bend around a wall
 *   one cell long, which ends in a one-spacing cap) is avoided;
 * - `variation`: run and straight vary over the canvas with a smooth seeded
 *   field (wavelength `scale` long edges): tighter and looser regions.
 * All randomness comes from the seed; nothing depends on the image, and the
 * start point only chooses where the loop is opened.
 *
 * Why: at order 0 the 15.3 tree (Kruskal on random weights = a uniform-like
 * random tree) has many dead ends and zig-zags; every dead end and every wall
 * end is a one-spacing cap in the line (≈ 35 % of all segments), which reads
 * as grain. The grown tree keeps the labyrinth but halves the short segments.
 */
export interface GrownMazeOptions {
  readonly seed: number;
  /** 0…1: share of "newest cell" steps (1 = one long winding corridor with few dead ends). */
  readonly run: number;
  /** 0…1: preference for going straight on. */
  readonly straight: number;
  /** 0…1: avoidance of immediate turn-backs (staircases). */
  readonly stairs: number;
  /** 0…1: avoidance of immediate hairpins (turning twice the same way: the wall between ends in a one-spacing cap). */
  readonly hairpins: number;
  /** 0…1: how strongly run and straight vary over the canvas. */
  readonly variation: number;
  /** Wavelength of the variation field in canvas long edges. */
  readonly scale: number;
}

/** Direction i: east, south, west, north. */
const DX = [1, 0, -1, 0] as const;
const DY = [0, 1, 0, -1] as const;

export function grownMaze(size: Size, o: RouteOptions, m: GrownMazeOptions): MazeRoute | (Route & { maze: null }) {
  const s = o.spacing;
  const g = coarseGrid(size, s);
  if (!g) return { ...meanderRows(size, o), maze: null };
  const { cw, ch, marginX, marginY } = g;
  const n = cw * ch;
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

  const rng = createRandom((Math.floor(m.seed) ^ 0x2545f491) >>> 0);
  // Smooth variation field in [0, 1] (three long waves, phases from the seed).
  const L = Math.max(size.width, size.height) * Math.max(0.05, m.scale);
  const waves = [0, 1, 2].map(() => ({ a: rng.range(0, Math.PI), phase: rng.range(0, 2 * Math.PI), weight: rng.range(0.6, 1) }));
  const variation = clamp01(m.variation);
  const runOf = new Float32Array(n), straightOf = new Float32Array(n);
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      const x = marginX + (2 * i + 1) * s, y = marginY + (2 * j + 1) * s;
      let v = 0;
      for (const w of waves) v += w.weight * Math.sin((2 * Math.PI * (x * Math.cos(w.a) + y * Math.sin(w.a))) / L + w.phase);
      const f = 0.5 + 0.5 * Math.tanh(v);
      runOf[j * cw + i] = clamp01(m.run) * (1 - variation) + f * variation;
      straightOf[j * cw + i] = clamp01(m.straight) * (1 - variation) + f * variation;
    }
  }
  const stairs = clamp01(m.stairs);
  const hairpins = clamp01(m.hairpins);

  // Direction the cell was entered from its parent (−1: root) and the parent's.
  const inDir = new Int8Array(n).fill(-1);
  const parentDir = new Int8Array(n).fill(-1);
  const visited = new Uint8Array(n);
  // Active list with tombstones (keeps the "newest" order; compacted when half dead).
  let active = new Int32Array(n);
  let size_ = 0, dead = 0;
  const alive = new Uint8Array(n);
  const tree = new Int32Array((n - 1) * 2);
  let edges = 0;

  const root = rng.int(0, n - 1);
  visited[root] = 1;
  active[size_++] = root;
  alive[root] = 1;
  const weights = [0, 0, 0, 0];
  while (size_ - dead > 0) {
    while (size_ > 0 && !alive[active[size_ - 1]!]) {
      size_--;
      dead--;
    }
    if (dead * 2 > size_) {
      let k = 0;
      for (let q = 0; q < size_; q++) if (alive[active[q]!]) active[k++] = active[q]!;
      size_ = k;
      dead = 0;
    }
    const newest = active[size_ - 1]!;
    let cell = newest;
    if (rng.next() >= runOf[newest]!) {
      do cell = active[Math.floor(rng.next() * size_)]!;
      while (!alive[cell]);
    }
    const ci = cell % cw, cj = Math.floor(cell / cw);
    const din = inDir[cell]!, dpar = parentDir[cell]!;
    const turned = din >= 0 && dpar >= 0 && din !== dpar;
    let total = 0, options = 0;
    for (let d = 0; d < 4; d++) {
      const ni = ci + DX[d]!, nj = cj + DY[d]!;
      weights[d] = 0;
      if (ni < 0 || nj < 0 || ni >= cw || nj >= ch || visited[nj * cw + ni]) continue;
      options++;
      let w = 1;
      if (d === din) w /= 1 - 0.95 * straightOf[cell]!;
      if (turned && d === dpar) w *= 1 - stairs;
      if (turned && d !== din && d !== dpar) w *= 1 - hairpins;
      weights[d] = w;
      total += w;
    }
    if (options === 0) {
      alive[cell] = 0;
      dead++;
      continue;
    }
    let pick = -1;
    if (total > 0) {
      let r = rng.next() * total;
      for (let d = 0; d < 4 && pick < 0; d++) {
        if (weights[d]! <= 0) continue;
        r -= weights[d]!;
        if (r < 0) pick = d;
      }
      if (pick < 0) for (let d = 3; d >= 0 && pick < 0; d--) if (weights[d]! > 0) pick = d;
    } else {
      // Only a staircase step is possible (stairs = 1): take it rather than leave a gap.
      for (let d = 0; d < 4 && pick < 0; d++) {
        const ni = ci + DX[d]!, nj = cj + DY[d]!;
        if (ni >= 0 && nj >= 0 && ni < cw && nj < ch && !visited[nj * cw + ni]) pick = d;
      }
    }
    const next = (cj + DY[pick]!) * cw + ci + DX[pick]!;
    visited[next] = 1;
    inDir[next] = pick;
    parentDir[next] = din;
    tree[edges * 2] = Math.min(cell, next);
    tree[edges * 2 + 1] = Math.max(cell, next);
    edges++;
    if (size_ === active.length) {
      const grown = new Int32Array(active.length * 2);
      grown.set(active);
      active = grown;
    }
    active[size_++] = next;
    alive[next] = 1;
  }
  return treeLoop(size, o, g, tree.subarray(0, edges * 2));
}

