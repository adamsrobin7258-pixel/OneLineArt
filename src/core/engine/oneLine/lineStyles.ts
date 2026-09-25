import { EngineError } from './errors';
import { dropDuplicatePoints, simplifyPolyline } from './geometry';
import { ORGANIC_LINE_SHAPE, runOneLineEngine, type LineShape, type OneLineRunHooks, type OneLineRunInput, type OneLineRunResult } from './generateOneLine';
import { ORTHOGONAL_LINE_SHAPE } from './orthogonal';
import { NEIGHBOUR_CROSSING_COST, buildCornerRoute, isReversal, neighboursCross, uncrossCorners, type CornerOf } from './routeRepair';
import type { OneLineEngineParameters } from './parameters';

export const GEOMETRIC_ENGINE_ID = 'geometric-stipple-tour';
export const GEOMETRIC_ENGINE_VERSION = '1.1.0';

/** Directions within this angle (radians) count as equal when merging straight runs. */
const DIRECTION_EPSILON = 1e-6;

/** Unit direction of a step, or null for a zero step. */
function octant(dx: number, dy: number): [number, number] | null {
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  return [dx / len, dy / len];
}

const sameDirection = (a: [number, number] | null, b: [number, number] | null) =>
  !!a && !!b && Math.abs(a[0] - b[0]) < DIRECTION_EPSILON && Math.abs(a[1] - b[1]) < DIRECTION_EPSILON;

/**
 * Costs of the corner choice (Viterbi, see octilinearChoices). They encode the
 * pre-14.2 rule — straight leg first, diagonal leg first only where it
 * continues the previous leg — and add one thing: a 180° reversal (a spike
 * back over the previous leg) is avoided whenever an alternative exists.
 * Keeping the straight leg first everywhere else matters: neighbouring,
 * roughly parallel connections then put their corners on the same side and
 * do not cross each other (minimizing every 45° turn instead alternates the
 * sides and adds crossings).
 */
const DIAGONAL_FIRST_COST = 0.5;
const CONTINUE_BONUS = 1;
/** As in the orthogonal style: a reversal outweighs any number of ordinary turns nearby. */
const REVERSAL_COST = 8;

/**
 * A segment whose smaller component (straight or diagonal) is below this share
 * of its larger one runs within ≈ 0.06° of an octilinear direction. Splitting
 * it would add a leg of a few thousandths of a pixel, whose direction float32
 * coordinates cannot even represent; instead its end point is moved onto the
 * octilinear direction (snapOctilinear) — by at most this share of the
 * segment, invisible — and it is drawn as one exact leg.
 */
const OCTILINEAR_SNAP = 1e-3;

/**
 * Moves the end of every nearly octilinear segment exactly onto its
 * octilinear direction (in order, so each segment starts where the previous
 * one ended). Returns a copy; the first point stays. See OCTILINEAR_SNAP.
 */
export function snapOctilinear(coords: Float64Array): Float64Array {
  const out = Float64Array.from(coords);
  for (let i = 0; i + 1 < out.length >> 1; i++) {
    const ax = out[i * 2]!, ay = out[i * 2 + 1]!, bx = out[i * 2 + 2]!, by = out[i * 2 + 3]!;
    const dx = bx - ax, dy = by - ay;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    const diagonal = Math.min(adx, ady), straight = Math.max(adx, ady) - diagonal;
    const snap = OCTILINEAR_SNAP * Math.max(adx, ady);
    if (diagonal > 0 && diagonal <= snap) {
      // Nearly horizontal / vertical: drop the tiny cross component.
      if (adx >= ady) out[i * 2 + 3] = ay;
      else out[i * 2 + 2] = ax;
    } else if (straight > 0 && straight <= snap) {
      // Nearly diagonal: equal components.
      const d = (adx + ady) / 2;
      out[i * 2 + 2] = ax + Math.sign(dx) * d;
      out[i * 2 + 3] = ay + Math.sign(dy) * d;
    }
  }
  return out;
}

/**
 * Corner of connection i: every segment becomes at most two octilinear legs,
 * one straight (horizontal or vertical, along the dominant axis) and one
 * diagonal. Choice 0 = straight leg first, 1 = diagonal leg first; null when
 * the segment already is octilinear (a single leg). The corner lies in the
 * segment's bounding box, so the line never leaves the canvas and never gets
 * longer than √2 × the segment; both choices have the same length.
 */
export function octilinearCorner(coords: Float64Array): CornerOf {
  return (i, choice) => {
    const ax = coords[i * 2]!, ay = coords[i * 2 + 1]!, bx = coords[i * 2 + 2]!, by = coords[i * 2 + 3]!;
    const dx = bx - ax, dy = by - ay;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    const diagonal = Math.min(adx, ady);
    const straight = Math.max(adx, ady) - diagonal;
    // Exactly (or, after snapOctilinear, up to float rounding) octilinear: one leg.
    const snap = OCTILINEAR_SNAP * Math.max(adx, ady);
    if (!(diagonal > snap && straight > snap)) return null;
    const sx = adx >= ady ? Math.sign(dx) * straight : 0;
    const sy = adx >= ady ? 0 : Math.sign(dy) * straight;
    return choice === 0 ? [ax + sx, ay + sy] : [bx - sx, by - sy];
  };
}

/** Cost of the junction between two legs: a reversal costs, continuing straight on earns a bonus. */
function junctionCost(a: [number, number] | null, b: [number, number] | null): number {
  if (!a || !b) return 0;
  if (isReversal(a[0], a[1], b[0], b[1])) return REVERSAL_COST;
  return sameDirection(a, b) ? -CONTINUE_BONUS : 0;
}

/**
 * Which leg comes first, decided for the WHOLE line at once (Viterbi over the
 * two choices per segment, like the orthogonal style): straight leg first,
 * the diagonal first where it continues the previous leg, and no 180°
 * reversal wherever an alternative exists. Deterministic.
 */
export function octilinearChoices(coords: Float64Array): Uint8Array {
  const m = Math.max(0, (coords.length >> 1) - 1);
  if (m === 0) return new Uint8Array(0);
  const cornerOf = octilinearCorner(coords);
  const first: ([number, number] | null)[][] = [];
  const last: ([number, number] | null)[][] = [];

  for (let i = 0; i < m; i++) {
    const ax = coords[i * 2]!, ay = coords[i * 2 + 1]!, bx = coords[i * 2 + 2]!, by = coords[i * 2 + 3]!;
    const f: ([number, number] | null)[] = [], l: ([number, number] | null)[] = [];
    for (let c = 0; c < 2; c++) {
      const k = cornerOf(i, c);
      const a = k ? octant(k[0] - ax, k[1] - ay) : octant(bx - ax, by - ay);
      f.push(a);
      l.push(k ? octant(bx - k[0], by - k[1]) : a);
    }
    first.push(f);
    last.push(l);
  }
  // Diagonal first costs a little (only where the connection has a corner at all).
  const own = (i: number, c: number) => (c === 1 && cornerOf(i, 1) ? DIAGONAL_FIRST_COST : 0);
  const cost = new Float64Array(m * 2);
  const from = new Uint8Array(m * 2);
  cost[0] = own(0, 0);
  cost[1] = own(0, 1);
  for (let i = 1; i < m; i++) {
    for (let c = 0; c < 2; c++) {
      let best = Infinity, arg = 0;
      for (let p = 0; p < 2; p++) {
        const value =
          cost[(i - 1) * 2 + p]! + junctionCost(last[i - 1]![p]!, first[i]![c]!) + (neighboursCross(coords, cornerOf, i - 1, p, c) ? NEIGHBOUR_CROSSING_COST : 0);
        if (value < best) {
          best = value;
          arg = p;
        }
      }
      cost[i * 2 + c] = best + own(i, c);
      from[i * 2 + c] = arg;
    }
  }
  const choice = new Uint8Array(m);
  choice[m - 1] = cost[(m - 1) * 2 + 1]! < cost[(m - 1) * 2]! ? 1 : 0;
  for (let i = m - 1; i > 0; i--) choice[i - 1] = from[i * 2 + choice[i]!]!;
  return choice;
}

/**
 * Replaces every segment by at most two octilinear legs (0°/45°/90°/…), see
 * octilinearCorner; which leg comes first is chosen for the whole line
 * (octilinearChoices). Keeps every vertex, in order. Deterministic.
 */
export function octilinearRoute(coords: Float64Array): Float64Array {
  if (coords.length >> 1 < 2) return coords;
  return buildCornerRoute(coords, octilinearChoices(coords), octilinearCorner(coords));
}

/** Drops points in the middle of a straight run (same direction before and after). */
export function mergeStraightRuns(coords: Float64Array): Float64Array {
  const n = coords.length >> 1;
  if (n < 3) return coords;
  const out = new Float64Array(coords.length);
  let o = 0;
  out[o++] = coords[0]!;
  out[o++] = coords[1]!;
  for (let i = 1; i < n - 1; i++) {
    const px = out[o - 2]!, py = out[o - 1]!;
    const x = coords[i * 2]!, y = coords[i * 2 + 1]!;
    const nx = coords[i * 2 + 2]!, ny = coords[i * 2 + 3]!;
    if (sameDirection(octant(x - px, y - py), octant(nx - x, ny - y))) continue;
    out[o++] = x;
    out[o++] = y;
  }
  out[o++] = coords[(n - 1) * 2]!;
  out[o++] = coords[(n - 1) * 2 + 1]!;
  return out.subarray(0, o);
}

/**
 * Geometric: the same optimized tour as Organic, drawn as straight lines with
 * sharp 45°/90° corners. No smoothing (it would round the corners); the tour
 * is straightened more strongly before routing so that long straight runs
 * appear. The result is still ONE connected line through every region.
 */
export const GEOMETRIC_LINE_SHAPE: LineShape = {
  id: GEOMETRIC_ENGINE_ID,
  version: GEOMETRIC_ENGINE_VERSION,
  prepare: (raw) => raw,
  finish: (prepared, tolerance) => {
    const points = dropDuplicatePoints(snapOctilinear(dropDuplicatePoints(simplifyPolyline(prepared, tolerance))));
    if (points.length >> 1 < 2) return points;
    const choices = octilinearChoices(points);
    const cornerOf = octilinearCorner(points);
    // Phase 14.2: switch corners whose legs cross other parts of the line (same points, same length).
    uncrossCorners(points, choices, cornerOf);
    return dropDuplicatePoints(mergeStraightRuns(buildCornerRoute(points, choices, cornerOf)));
  },
};

/** A path-generating style engine; all return the same OneLinePath format. */
export interface OneLineEngine {
  readonly id: string;
  readonly version: string;
  run(input: OneLineRunInput, parameters: OneLineEngineParameters, hooks: OneLineRunHooks): OneLineRunResult;
}

const engineFor = (shape: LineShape): OneLineEngine => ({
  id: shape.id,
  version: shape.version,
  run: (input, parameters, hooks) => runOneLineEngine(shape, input, parameters, hooks),
});

/** Registry of the available engines by id. New styles register here — no branching in the engine. */
export const ONE_LINE_ENGINES: Readonly<Record<string, OneLineEngine>> = Object.fromEntries(
  [ORGANIC_LINE_SHAPE, GEOMETRIC_LINE_SHAPE, ORTHOGONAL_LINE_SHAPE].map((shape) => [shape.id, engineFor(shape)]),
);

/** The engine for an id; unknown ids are a controlled parameter error. */
export function oneLineEngine(id: string): OneLineEngine {
  const engine = Object.prototype.hasOwnProperty.call(ONE_LINE_ENGINES, id) ? ONE_LINE_ENGINES[id] : undefined;
  if (!engine) throw new EngineError('invalid-parameters', `Unknown drawing engine "${id}"`);
  return engine;
}
