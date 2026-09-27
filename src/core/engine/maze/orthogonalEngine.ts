import type { ScalarField } from '../../models';
import type { OneLineEngineParameters } from '../oneLine/parameters';
import type { OneLineRunHooks, OneLineRunInput, OneLineRunResult } from '../oneLine/generateOneLine';
import { EngineError } from '../oneLine/errors';
import { sanitizeOneLineSettings } from '../oneLine/parameterLimits';
import { pathFromCoords } from '../path';
import { validateOneLinePath } from '../validation';
import { grownMaze, type GrownMazeOptions } from './lattice';
import type { WidthLineParameters } from './parameters';
import { MAX_RUN, SAMPLE_STEP, buildWidthLine } from './widthLine';

/**
 * The Orthogonal style (phase 16): the "Free Orthogonal – grown" line tested
 * in phase 15.4 on a Xiaomi 15 Ultra, with exactly its reference parameters.
 *
 * ONE line on a lattice of constant spacing (see lattice.ts): only horizontal
 * and vertical segments, only 90° turns, no crossing, a free start point. The
 * route depends only on the working-grid size, the seed and the start point —
 * never on the image; the image only sets the line WIDTH per point (dark =
 * thick), which the path carries in `widths`. Pure and deterministic.
 */
export const ORTHOGONAL_ENGINE_ID = 'orthogonal-grown-maze';
/** Bump whenever output for identical input changes. */
export const ORTHOGONAL_ENGINE_VERSION = '2.0.0';

/**
 * Line and tone of the tested reference: 3 px spacing on an 800 px working
 * grid (a share of the picture, not a display pixel), widths 0.338 … 2.475 px
 * ("safe": the thickest line leaves a gap of 17.5 % of the spacing), the
 * default tone preparation of the prototype.
 */
export const ORTHOGONAL_LINE_PARAMETERS: WidthLineParameters = {
  workingLongEdge: 800,
  spacing: 3,
  minWidth: 0.338,
  maxWidth: 2.475,
  contrast: 0,
  detail: 0.6,
  smoothing: 0.35,
  curve: 'perceptual',
  autoLevels: true,
};

/** Labyrinth of the tested reference (phase 15.4 defaults); the seed comes from the drawing settings. */
export const ORTHOGONAL_MAZE_PARAMETERS: Omit<GrownMazeOptions, 'seed'> = { run: 0.9, straight: 0.2, stairs: 1, hairpins: 0.7, variation: 0, scale: 0.6 };

/** Start of the line when the drawing settings leave it automatic: the top-left corner (as tested). */
export const ORTHOGONAL_AUTO_START = { x: 0, y: 0 } as const;

/**
 * Runs the Orthogonal style. The stipple parameters of the Organic engine do
 * not apply (the line and the labyrinth are fixed above); they are accepted so
 * all styles share one engine interface.
 */
export function generateOrthogonalLine(input: OneLineRunInput, _parameters: OneLineEngineParameters, hooks: OneLineRunHooks): OneLineRunResult {
  const { image } = input;
  if (!(image.width > 0 && image.height > 0) || image.data.length !== image.width * image.height * 4) throw new EngineError('invalid-analysis', 'Image has no area');
  const settings = sanitizeOneLineSettings(input.settings).value;
  const checkAbort = () => {
    if (hooks.shouldAbort?.()) throw new EngineError('aborted', 'Path generation aborted');
  };
  const p = ORTHOGONAL_LINE_PARAMETERS;
  const start = settings.startPoint ?? ORTHOGONAL_AUTO_START;
  const line = buildWidthLine(image, p, (working) => {
    checkAbort();
    hooks.onProgress?.(0.3);
    return grownMaze(working, { spacing: p.spacing, start, step: SAMPLE_STEP }, { ...ORTHOGONAL_MAZE_PARAMETERS, seed: settings.seed });
  });
  checkAbort();
  hooks.onProgress?.(0.9);

  const path = pathFromCoords(
    line.coords,
    { width: image.width, height: image.height },
    {
      generatorId: ORTHOGONAL_ENGINE_ID,
      generatorVersion: ORTHOGONAL_ENGINE_VERSION,
      seed: settings.seed,
      ...(input.analysis.meta.sourceImageId ? { sourceImageId: input.analysis.meta.sourceImageId } : {}),
    },
    line.widths,
  );
  // A merged straight run is at most MAX_RUN route samples long: anything longer would be a jump
  // (1 % margin for the float32 coordinates of the stored line).
  const report = validateOneLinePath(path, { maxSegmentLength: MAX_RUN * SAMPLE_STEP * line.scale * 1.01, maxZeroLengthShare: 0 });
  if (!report.valid) throw new EngineError('invalid-result', report.errors.join(' '));
  hooks.onProgress?.(1);

  // "Demand" for the metrics: the darkness the widths follow, on the working grid.
  const tone = line.tone.field;
  const demand: ScalarField = { width: tone.width, height: tone.height, data: Float32Array.from(tone.data, (v) => 1 - v) };
  const routePoints = line.route.coords.length >> 1;
  return {
    path,
    demand,
    diagnostics: {
      workingSize: { ...line.working },
      demandPoints: line.route.lines,
      startPoint: 0,
      optimizationMoves: 0,
      optimizationEvaluations: 0,
      rawPoints: routePoints,
      smoothedPoints: routePoints,
      finalPoints: line.coords.length >> 1,
      simplificationTolerance: 0,
    },
  };
}
