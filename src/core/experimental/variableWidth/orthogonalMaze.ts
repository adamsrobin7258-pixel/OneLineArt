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
  const cw = Math.floor(W / (2 * s)), ch = Math.floor(H / (2 * s));
  if (cw < 1 || ch < 1 || cw * ch < 2) return { ...meanderRows(size, o), maze: null };
  const fw = 2 * cw, fh = 2 * ch;
  const marginX = (W - fw * s) / 2, marginY = (H - fh * s) / 2;

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
  let treeEdges = 0;
  for (const k of index) {
    const { a, b } = edges[k]!;
    const ra = find(parent, a), rb = find(parent, b);
    if (ra === rb) continue;
    parent[ra] = rb;
    treeEdges++;
    const ai = a % cw, aj = Math.floor(a / cw);
    if (b === a + 1) {
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
    if (treeEdges === n - 1) break;
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
