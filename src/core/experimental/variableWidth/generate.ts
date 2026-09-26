import type { OneLinePath, RasterImage, Size } from '../../models';
import { sanitizeVariableWidthParameters, type VariableWidthIssue, type VariableWidthParameters } from './parameters';
import { arcSpiral, flowCurve, organicMeander, type CurvedRouteDiagnostics } from './curvedRoutes';
import { orthogonalMaze } from './orthogonalMaze';
import { meanderColumns, meanderRows, spiral, type Route, type RouteOptions } from './routes';
import { buildToneField, sampleField, type ToneField } from './toneField';
import { createWidthTransfer } from './transfer';

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

/** Sample distance along the centre line, working px (the width can change this finely). */
const SAMPLE_STEP = 1;
/** Merging straight runs: deviations below these are invisible (working px). */
const POSITION_TOLERANCE = 0.02;
const WIDTH_TOLERANCE = 0.02;
/** Longest merged run in samples: bounds the work and the segment length. */
const MAX_RUN = 32;

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
  if (p.route === 'spiral') return spiral(size, options);
  if (p.route === 'meander-columns') return meanderColumns(size, options);
  return meanderRows(size, options);
}

/**
 * Drops samples that lie on the straight line (and linear width ramp) between
 * their neighbours. Keeps first and last point; deterministic, O(n · MAX_RUN).
 */
function mergeStraightRuns(coords: Float64Array, widths: Float64Array): number[] {
  const n = coords.length >> 1;
  const along = new Float64Array(n);
  for (let i = 1; i < n; i++) along[i] = along[i - 1]! + Math.hypot(coords[i * 2]! - coords[i * 2 - 2]!, coords[i * 2 + 1]! - coords[i * 2 - 1]!);
  const keep: number[] = [0];
  let anchor = 0;
  let j = anchor + 2;
  while (j < n) {
    let ok = j - anchor <= MAX_RUN;
    if (ok) {
      const ax = coords[anchor * 2]!, ay = coords[anchor * 2 + 1]!, aw = widths[anchor]!;
      const bx = coords[j * 2]!, by = coords[j * 2 + 1]!, bw = widths[j]!;
      const total = along[j]! - along[anchor]!;
      for (let i = anchor + 1; i < j && ok; i++) {
        const t = total > 0 ? (along[i]! - along[anchor]!) / total : 0;
        const ex = ax + (bx - ax) * t, ey = ay + (by - ay) * t, ew = aw + (bw - aw) * t;
        ok = Math.hypot(coords[i * 2]! - ex, coords[i * 2 + 1]! - ey) <= POSITION_TOLERANCE && Math.abs(widths[i]! - ew) <= WIDTH_TOLERANCE;
      }
    }
    if (ok) {
      j++;
      continue;
    }
    anchor = j - 1;
    keep.push(anchor);
    j = anchor + 2;
  }
  if (n > 1) keep.push(n - 1);
  return keep;
}

export function generateVariableWidthLine(image: RasterImage, input: Partial<VariableWidthParameters> = {}): VariableWidthLine {
  if (!(image.width > 0 && image.height > 0) || image.data.length !== image.width * image.height * 4) {
    throw new RangeError(`Invalid image ${image.width}×${image.height}`);
  }
  const { value: p, issues } = sanitizeVariableWidthParameters(input);
  const tone = buildToneField(image, p);
  const working: Size = { width: tone.field.width, height: tone.field.height };
  const route = variableWidthRoute(working, p);
  const widthOf = createWidthTransfer(p);

  const n = route.coords.length >> 1;
  const widths = new Float64Array(n);
  let frame = 0;
  for (let i = 0; i < n; i++) {
    if (route.frame[i]) {
      widths[i] = p.minWidth;
      frame++;
    } else {
      widths[i] = widthOf(sampleField(tone.field, route.coords[i * 2]!, route.coords[i * 2 + 1]!));
    }
  }

  const keep = mergeStraightRuns(route.coords, widths);
  const sx = image.width / working.width;
  const sy = image.height / working.height;
  const scale = (sx + sy) / 2;
  const coords = new Float32Array(keep.length * 2);
  const outWidths = new Float32Array(keep.length);
  keep.forEach((k, i) => {
    coords[i * 2] = Math.min(image.width, route.coords[k * 2]! * sx);
    coords[i * 2 + 1] = Math.min(image.height, route.coords[k * 2 + 1]! * sy);
    outWidths[i] = widths[k]! * scale;
  });
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
      points: keep.length,
      frameShare: n ? frame / n : 0,
      levels: tone.levels,
      noiseSigma: tone.noiseSigma,
      length,
      curved: route.curved ?? null,
    },
  };
}
