import type { RasterImage, Size } from '../../models';
import type { WidthLineParameters } from './parameters';
import type { Route } from './routes';
import { buildToneField, sampleField, type ToneField } from './toneField';
import { createWidthTransfer } from './widthTransfer';

/** Sample distance along the centre line, working px (the width can change this finely). */
export const SAMPLE_STEP = 1;
/** Merging straight runs: deviations below these are invisible (working px). */
const POSITION_TOLERANCE = 0.02;
const WIDTH_TOLERANCE = 0.02;
/** Longest merged run in samples: bounds the work and the segment length. */
export const MAX_RUN = 32;

/**
 * Drops samples that lie on the straight line (and linear width ramp) between
 * their neighbours. Keeps first and last point; deterministic, O(n · MAX_RUN).
 */
export function mergeStraightRuns(coords: Float64Array, widths: Float64Array): number[] {
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

export interface WidthLine<R extends Route = Route> {
  /** Centre line in image px; widths in image px, one per point. */
  readonly coords: Float32Array;
  readonly widths: Float32Array;
  readonly tone: ToneField;
  readonly working: Size;
  readonly route: R;
  /** Route samples drawn at the minimum width because they lie on the border (spiral frame). */
  readonly frame: number;
  /** Image px per working px (mean of both axes). */
  readonly scale: number;
}

/**
 * THE step from a route to the drawn line (phase 15.1, unchanged; production
 * since phase 16): the width at every route sample comes from the tone field
 * (the only place the image enters), straight runs with a linear width ramp
 * are merged, and everything is mapped to image px. The route itself is built
 * by `routeFor` on the working grid and never sees the image.
 */
export function buildWidthLine<R extends Route>(image: RasterImage, p: WidthLineParameters, routeFor: (working: Size) => R): WidthLine<R> {
  const tone = buildToneField(image, p);
  const working: Size = { width: tone.field.width, height: tone.field.height };
  const route = routeFor(working);
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
  return { coords, widths: outWidths, tone, working, route, frame, scale };
}
