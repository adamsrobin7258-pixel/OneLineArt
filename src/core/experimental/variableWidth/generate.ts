import type { OneLinePath, RasterImage, Size } from '../../models';
import { sanitizeVariableWidthParameters, type VariableWidthIssue, type VariableWidthParameters } from './parameters';
import { arcSpiral, flowCurve, organicMeander, type CurvedRouteDiagnostics } from './curvedRoutes';
import { grownMaze, orthogonalMaze } from './orthogonalMaze';
import { meanderColumns, meanderRows, spiral, type Route, type RouteOptions } from './routes';
import type { ToneField } from './toneField';
import { SAMPLE_STEP, buildWidthLine } from '../../engine/maze/widthLine';

export const VARIABLE_WIDTH_GENERATOR_ID = 'experimental-variable-width';
export const VARIABLE_WIDTH_VERSION = '0.2.0';

/**
 * EXPERIMENTAL (Phase 15.1): one continuous line at constant spacing whose
 * WIDTH carries the tone. The centre line is a plain OneLinePath (so the
 * existing validation applies unchanged); the widths are a parallel array.
 * Not wired into the app, the engines or projects.
 */
export interface VariableWidthLine {
  /** Centre line in image px (bounds = image size); index order = drawing order. */
  readonly path: OneLinePath;
  /** Line width per point, image px, within [minWidth, maxWidth] × scale. */
  readonly widths: Float32Array;
  /** Spacing, min and max width in image px. */
  readonly spacing: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  /** Parameters after validation, and what was adjusted. */
  readonly parameters: VariableWidthParameters;
  readonly issues: readonly VariableWidthIssue[];
  readonly working: Size;
  readonly diagnostics: VariableWidthDiagnostics;
}

export interface VariableWidthDiagnostics {
  /** Rows (meander) or turns (spiral). */
  readonly lines: number;
  /** Samples of the centre line before / after merging straight runs. */
  readonly routePoints: number;
  readonly points: number;
  /** Share of the route that runs on the border (spiral corners). */
  readonly frameShare: number;
  readonly levels: ToneField['levels'];
  readonly noiseSigma: number;
  /** Centre line length, image px. */
  readonly length: number;
  /** Phase 15.2 curved routes only: split rows, cusps, clamped points (all 0 when the geometry holds). */
  readonly curved: CurvedRouteDiagnostics | null;
}

/** Flowing curve: rows across the sweep diagonal, river-curve wavelength 1.8 canvas diagonals. */
export const FLOW_SHAPE = { tilt: 0.5, wavelength: 1.8 } as const;

/**
 * The centre line of a route. Depends on the working-grid size and the route
 * parameters (route, spacing, start, arcCenter, bend, maze*) only — never on the image.
 */
export function variableWidthRoute(size: Size, p: VariableWidthParameters): Route & { curved?: CurvedRouteDiagnostics } {
  const options: RouteOptions = { spacing: p.spacing, start: p.start, step: SAMPLE_STEP };
  if (p.route === 'arc-spiral') return arcSpiral(size, options, p.arcCenter);
  if (p.route === 'organic-meander') return organicMeander(size, options, p.bend);
  if (p.route === 'flow') return flowCurve(size, options, { ...FLOW_SHAPE, bend: p.bend });
  if (p.route === 'free-orthogonal') return orthogonalMaze(size, options, { seed: p.mazeSeed, order: p.mazeOrder, scale: p.mazeScale });
  if (p.route === 'free-orthogonal-grown') {
    return grownMaze(size, options, { seed: p.mazeSeed, run: p.mazeRun, straight: p.mazeStraight, stairs: p.mazeStairs, hairpins: p.mazeHairpins, variation: p.mazeVariation, scale: p.mazeScale });
  }
  if (p.route === 'spiral') return spiral(size, options);
  if (p.route === 'meander-columns') return meanderColumns(size, options);
  return meanderRows(size, options);
}

export function generateVariableWidthLine(image: RasterImage, input: Partial<VariableWidthParameters> = {}): VariableWidthLine {
  if (!(image.width > 0 && image.height > 0) || image.data.length !== image.width * image.height * 4) {
    throw new RangeError(`Invalid image ${image.width}×${image.height}`);
  }
  const { value: p, issues } = sanitizeVariableWidthParameters(input);
  const line = buildWidthLine(image, p, (size) => variableWidthRoute(size, p));
  const { coords, widths: outWidths, tone, working, route, frame, scale } = line;
  const n = route.coords.length >> 1;
  let length = 0;
  for (let i = 2; i < coords.length; i += 2) length += Math.hypot(coords[i]! - coords[i - 2]!, coords[i + 1]! - coords[i - 1]!);

  return {
    path: {
      coords,
      bounds: { width: image.width, height: image.height },
      meta: { generatorId: VARIABLE_WIDTH_GENERATOR_ID, generatorVersion: VARIABLE_WIDTH_VERSION, seed: 0 },
    },
    widths: outWidths,
    spacing: p.spacing * scale,
    minWidth: p.minWidth * scale,
    maxWidth: p.maxWidth * scale,
    parameters: p,
    issues,
    working,
    diagnostics: {
      lines: route.lines,
      routePoints: n,
      points: coords.length >> 1,
      frameShare: n ? frame / n : 0,
      levels: tone.levels,
      noiseSigma: tone.noiseSigma,
      length,
      curved: route.curved ?? null,
    },
  };
}
