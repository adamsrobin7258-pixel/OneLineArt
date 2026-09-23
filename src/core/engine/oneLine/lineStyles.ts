import { EngineError } from './errors';
import { dropDuplicatePoints, simplifyPolyline } from './geometry';
import { ORGANIC_LINE_SHAPE, runOneLineEngine, type LineShape, type OneLineRunHooks, type OneLineRunInput, type OneLineRunResult } from './generateOneLine';
import type { OneLineEngineParameters } from './parameters';

export const GEOMETRIC_ENGINE_ID = 'geometric-stipple-tour';
export const GEOMETRIC_ENGINE_VERSION = '1.0.0';

/** Directions within this angle (radians) count as equal when merging straight runs. */
const DIRECTION_EPSILON = 1e-6;

/** Unit direction of the eight octilinear directions, or null for a zero step. */
function octant(dx: number, dy: number): [number, number] | null {
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  return [dx / len, dy / len];
}

const sameDirection = (a: [number, number] | null, b: [number, number] | null) =>
  !!a && !!b && Math.abs(a[0] - b[0]) < DIRECTION_EPSILON && Math.abs(a[1] - b[1]) < DIRECTION_EPSILON;

/**
 * Replaces every segment by at most two octilinear legs (0°/45°/90°/…):
 * one straight (horizontal or vertical) and one diagonal. The corner lies in
 * the segment's bounding box, so the line never leaves the canvas and never
 * gets longer than √2 × the original segment. Of the two possible corners the
 * one continuing the previous direction is chosen (fewer turns, longer
 * straight runs); otherwise the straight leg comes first. Deterministic.
 */
export function octilinearRoute(coords: Float64Array): Float64Array {
  const n = coords.length >> 1;
  if (n < 2) return coords;
  const out = new Float64Array((2 * n - 1) * 2);
  let o = 0;
  out[o++] = coords[0]!;
  out[o++] = coords[1]!;
  let previous: [number, number] | null = null;
  for (let i = 1; i < n; i++) {
    const ax = coords[i * 2 - 2]!, ay = coords[i * 2 - 1]!;
    const bx = coords[i * 2]!, by = coords[i * 2 + 1]!;
    const dx = bx - ax, dy = by - ay;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    const diagonal = Math.min(adx, ady);
    const straight = Math.max(adx, ady) - diagonal;
    if (diagonal > 1e-9 && straight > 1e-9) {
      // Straight leg along the dominant axis, diagonal leg across both.
      const sxStraight = adx >= ady ? Math.sign(dx) * straight : 0;
      const syStraight = adx >= ady ? 0 : Math.sign(dy) * straight;
      const diagonalFirst = sameDirection(previous, octant(dx - sxStraight, dy - syStraight)) && !sameDirection(previous, octant(sxStraight, syStraight));
      const cx = diagonalFirst ? bx - sxStraight : ax + sxStraight;
      const cy = diagonalFirst ? by - syStraight : ay + syStraight;
      out[o++] = cx;
      out[o++] = cy;
    }
    out[o++] = bx;
    out[o++] = by;
    const lastX = out[o - 4]!, lastY = out[o - 3]!;
    previous = octant(bx - lastX, by - lastY) ?? previous;
  }
  return out.subarray(0, o);
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
  finish: (prepared, tolerance) => dropDuplicatePoints(mergeStraightRuns(octilinearRoute(dropDuplicatePoints(simplifyPolyline(prepared, tolerance))))),
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
  [ORGANIC_LINE_SHAPE, GEOMETRIC_LINE_SHAPE].map((shape) => [shape.id, engineFor(shape)]),
);

/** The engine for an id; unknown ids are a controlled parameter error. */
export function oneLineEngine(id: string): OneLineEngine {
  const engine = Object.prototype.hasOwnProperty.call(ONE_LINE_ENGINES, id) ? ONE_LINE_ENGINES[id] : undefined;
  if (!engine) throw new EngineError('invalid-parameters', `Unknown drawing engine "${id}"`);
  return engine;
}
