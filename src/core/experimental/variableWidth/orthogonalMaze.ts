import type { Size } from '../../models';
import { createRandom } from '../../utils';
import { coarseGrid, treeLoop, type MazeRoute } from '../../engine/maze/lattice';
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

/** Phase 16: MazeRoute, the lattice loop and the grown maze live in the production module (engine/maze/lattice.ts). */
export { grownMaze, type GrownMazeOptions, type MazeRoute } from '../../engine/maze/lattice';

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

