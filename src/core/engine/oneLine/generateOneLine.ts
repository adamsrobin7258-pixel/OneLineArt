import type { OneLinePath, OneLineSettings, RasterImage, ScalarField } from '../../models';
import type { ImageAnalysis } from '../../imageAnalysis';
import type { Random } from '../../utils';
import { pathFromCoords } from '../path';
import { validateOneLinePath, type PathValidationOptions } from '../validation';
import { buildAdaptiveDemandField } from './demandField';
import { sanitizeEngineParameters, sanitizeOneLineSettings } from './parameterLimits';
import { buildOrientationField, contourAwareCost } from './orientationField';
import { EngineError } from './errors';
import { chaikinOpen, dropDuplicatePoints, simplifyPolyline } from './geometry';
import { ONE_LINE_ENGINE_VERSION, REFERENCE_LONG_EDGE, pointBudgetFor, type OneLineEngineParameters } from './parameters';
import { relaxStipples, sampleStipples } from './stippling';
import { optimizeTour, spaceFillingTour } from './tour';

export const ONE_LINE_ENGINE_ID = 'importance-stipple-tour';

/** A segment longer than this many sparsest-area point spacings is a jump. */
const JUMP_SPACING_FACTOR = 4;

/** Expected distance between neighbouring demand points where demand is lowest, in grid px. */
function sparsestSpacing(demand: ScalarField, points: number): number {
  let total = 0;
  let min = Infinity;
  for (const v of demand.data) {
    total += v;
    if (v < min) min = v;
  }
  return points > 0 && min > 0 ? Math.sqrt(total / (points * min)) : Math.hypot(demand.width, demand.height);
}

export interface OneLineRunInput {
  readonly image: RasterImage;
  readonly analysis: ImageAnalysis;
  readonly settings: OneLineSettings;
}

export interface OneLineRunHooks {
  readonly rng: Random;
  readonly onProgress?: ((progress: number) => void) | undefined;
  readonly shouldAbort?: (() => boolean) | undefined;
}

/** Internal numbers of one run, for the developer view. */
export interface OneLineDiagnostics {
  readonly workingSize: { readonly width: number; readonly height: number };
  readonly demandPoints: number;
  readonly startPoint: number;
  readonly optimizationMoves: number;
  readonly optimizationEvaluations: number;
  readonly rawPoints: number;
  readonly smoothedPoints: number;
  readonly finalPoints: number;
  readonly simplificationTolerance: number;
}

export interface OneLineRunResult {
  readonly path: OneLinePath;
  readonly demand: ScalarField;
  readonly diagnostics: OneLineDiagnostics;
}

/**
 * Validation rules the engine guarantees for its own output. A segment counts
 * as a jump when it is longer than a fraction of the diagonal AND far longer
 * than the point spacing expected in the sparsest area.
 */
export function engineValidationOptions(
  parameters: OneLineEngineParameters,
  bounds: { width: number; height: number },
  sparsestSpacing = 0,
): PathValidationOptions {
  return {
    maxSegmentLength: Math.max(parameters.maxSegmentFraction * Math.hypot(bounds.width, bounds.height), JUMP_SPACING_FACTOR * sparsestSpacing, 2),
    maxZeroLengthShare: parameters.maxZeroLengthShare,
  };
}

/**
 * The One-Line engine:
 *
 *  1. demand field   — how much line each area needs (importance, tone, global relevance)
 *  2. demand points  — stratified seeded sampling + weighted Lloyd relaxation
 *  3. start          — most globally relevant, most demanding point (deterministic)
 *  4. tour           — closed Moore space-filling route, opened at the start (no long jumps)
 *  5. optimization   — 2-opt on contour-aware length + curvature (open path, fixed start)
 *  6. geometry       — map to image px, Chaikin smoothing, Douglas–Peucker
 *  7. validation     — one connected, finite, in-bounds, renderable line
 *
 * Every demand point is visited exactly once, so the line cannot get stuck in
 * one area, and the connections between regions come from the same route
 * optimization that shapes the details. Pure and deterministic.
 *
 * `generateOneLine` is the Organic style; other styles share steps 1–5 and 7
 * and bring their own step 6 (see LineShape / lineStyles.ts).
 */
export function generateOneLine(input: OneLineRunInput, rawParameters: OneLineEngineParameters, hooks: OneLineRunHooks): OneLineRunResult {
  return runOneLineEngine(ORGANIC_LINE_SHAPE, input, rawParameters, hooks);
}

/**
 * How a style turns the optimized tour (image px) into the final line —
 * the only step in which the styles differ. Both functions must keep the
 * polyline ONE connected path (in order, no new far-away points).
 */
export interface LineShape {
  /** Engine identity of the style (stored in path meta and settings keys). */
  readonly id: string;
  /** Bump whenever this style's output for identical input changes. */
  readonly version: string;
  /** Tolerance-independent step on the raw tour (e.g. smoothing). */
  prepare(raw: Float64Array, parameters: OneLineEngineParameters): Float64Array;
  /** Final polyline at a simplification tolerance (coarsened while above maxPoints). */
  finish(prepared: Float64Array, tolerance: number): Float64Array;
}

/** Organic: soft curves — Chaikin smoothing, then Douglas–Peucker. */
export const ORGANIC_LINE_SHAPE: LineShape = {
  id: ONE_LINE_ENGINE_ID,
  version: ONE_LINE_ENGINE_VERSION,
  prepare: (raw, parameters) => chaikinOpen(raw, Math.max(0, Math.floor(parameters.smoothingIterations)), parameters.smoothingRatio),
  finish: (prepared, tolerance) => dropDuplicatePoints(simplifyPolyline(prepared, tolerance)),
};

/** Steps 1–7 with the style's line shape in step 6. */
export function runOneLineEngine(shape: LineShape, input: OneLineRunInput, rawParameters: OneLineEngineParameters, hooks: OneLineRunHooks): OneLineRunResult {
  const { image, analysis } = input;
  // Central validation: rejects non-finite values, clamps to the safety limits.
  const parameters = sanitizeEngineParameters(rawParameters).value;
  const settings = sanitizeOneLineSettings(input.settings).value;
  const shouldAbort = hooks.shouldAbort ?? (() => false);
  const progress = (value: number) => hooks.onProgress?.(value);
  const checkAbort = () => {
    if (shouldAbort()) throw new EngineError('aborted', 'Path generation aborted');
  };
  if (!(image.width > 0 && image.height > 0)) throw new EngineError('invalid-analysis', 'Image has no area');

  // 1. Demand (working grid grows if the densest area would be unrepresentable)
  const requested = Math.max(2, Math.min(pointBudgetFor(parameters, settings.detail), Math.floor(settings.maxPoints)));
  const { demand, global } = buildAdaptiveDemandField(analysis, parameters, requested);
  const { width: gw, height: gh } = demand;
  progress(0.05);
  checkAbort();

  // 2. Demand points
  const budget = Math.max(2, Math.min(requested, gw * gh * 4));
  const stipples = sampleStipples(demand, budget, hooks.rng.fork('stipple'));
  relaxStipples(demand, stipples, Math.max(0, Math.floor(parameters.relaxationIterations)), shouldAbort);
  checkAbort();
  progress(0.45);

  // 3. Deterministic start: the point nearest a fixed start, or (auto) the
  //    point with the highest global relevance × demand.
  const { xs, ys } = stipples;
  const sampleAt = (field: ScalarField, x: number, y: number) =>
    field.data[Math.min(field.height - 1, Math.floor(y)) * field.width + Math.min(field.width - 1, Math.floor(x))]!;
  let start = 0;
  let bestScore = -Infinity;
  const fixed = settings.startPoint;
  for (let i = 0; i < xs.length; i++) {
    const score = fixed
      ? -Math.hypot(xs[i]! - fixed.x * gw, ys[i]! - fixed.y * gh)
      : sampleAt(global, xs[i]!, ys[i]!) * sampleAt(demand, xs[i]!, ys[i]!);
    if (score > bestScore) {
      bestScore = score;
      start = i;
    }
  }

  // 4 + 5. Tour
  const order = spaceFillingTour(xs, ys, gw, gh, start);
  checkAbort();
  progress(0.55);
  const orientation = parameters.contourAlignment > 0 ? buildOrientationField(analysis, demand, parameters.contourScale) : null;
  checkAbort();
  const stats = optimizeTour(xs, ys, order, gw, gh, {
    ...(orientation
      ? { edgeCost: (a: number, b: number) => contourAwareCost(orientation, parameters.contourAlignment, xs[a]!, ys[a]!, xs[b]!, ys[b]!) }
      : {}),
    neighborCount: parameters.neighborCount,
    curvaturePenalty: parameters.curvaturePenalty,
    maxMoves: Math.max(0, Math.floor(parameters.maxMovesPerPoint * xs.length)),
    shouldAbort,
  });
  progress(0.85);

  // 6. Geometry in image coordinates (style-specific shape)
  const sx = image.width / gw;
  const sy = image.height / gh;
  const raw = new Float64Array(order.length * 2);
  for (let i = 0; i < order.length; i++) {
    raw[i * 2] = xs[order[i]!]! * sx;
    raw[i * 2 + 1] = ys[order[i]!]! * sy;
  }
  const smoothed = shape.prepare(raw, parameters);
  let tolerance = Math.max(0, parameters.simplificationTolerance) * (Math.max(image.width, image.height) / REFERENCE_LONG_EDGE);
  let simplified = shape.finish(smoothed, tolerance);
  // Respect the point cap by coarsening the tolerance (deterministic, bounded).
  for (let guard = 0; (simplified.length >> 1) > settings.maxPoints && guard < 24; guard++) {
    tolerance = Math.max(tolerance * 2, 0.01);
    simplified = shape.finish(smoothed, tolerance);
  }
  const coords = new Float32Array(simplified.length);
  for (let i = 0; i < simplified.length; i += 2) {
    coords[i] = Math.min(image.width, Math.max(0, simplified[i]!));
    coords[i + 1] = Math.min(image.height, Math.max(0, simplified[i + 1]!));
  }

  const path = pathFromCoords(coords, { width: image.width, height: image.height }, {
    generatorId: shape.id,
    generatorVersion: shape.version,
    seed: settings.seed,
    ...(analysis.meta.sourceImageId ? { sourceImageId: analysis.meta.sourceImageId } : {}),
  });

  // 7. Validation
  const spacing = sparsestSpacing(demand, xs.length) * Math.max(sx, sy);
  const report = validateOneLinePath(path, engineValidationOptions(parameters, image, spacing));
  if (!report.valid) throw new EngineError('invalid-result', report.errors.join(' '));
  progress(1);

  return {
    path,
    demand,
    diagnostics: {
      workingSize: { width: gw, height: gh },
      demandPoints: xs.length,
      startPoint: start,
      optimizationMoves: stats.moves,
      optimizationEvaluations: stats.evaluations,
      rawPoints: order.length,
      smoothedPoints: smoothed.length >> 1,
      finalPoints: coords.length >> 1,
      simplificationTolerance: tolerance,
    },
  };
}
