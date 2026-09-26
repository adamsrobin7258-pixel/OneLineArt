import { describe, expect, it } from 'vitest';
import { hashBytes, validateOneLinePath, type RasterImage } from '../../../src/core';
import {
  DEFAULT_VARIABLE_WIDTH_PARAMETERS,
  MAX_WIDTH_SHARE,
  compareRendering,
  contrastCurve,
  createWidthTransfer,
  generateVariableWidthLine,
  measureMeanderSpacing,
  sanitizeVariableWidthParameters,
  spiral,
  variableWidthOutline,
  variableWidthRoute,
  variableWidthSvg,
  type VariableWidthLine,
  type VariableWidthParameters,
} from '../../../src/core/experimental/variableWidth';
import { raster, solid } from '../../fixtures/rasters';
import { MOTIFS } from '../../fixtures/scenes';

/** Small working grid keeps the tests fast; the algorithm is resolution-independent. */
const SMALL: Partial<VariableWidthParameters> = { workingLongEdge: 200 };
const run = (image: RasterImage, p: Partial<VariableWidthParameters> = {}) => generateVariableWidthLine(image, { ...SMALL, ...p });

/** Horizontal gradient: black on the left, white on the right. */
const gradient = (w = 200, h = 120) => raster(w, h, (x) => Math.round((255 * x) / (w - 1)));

/** Seeded ±amplitude noise around a grey level. */
function noisy(w: number, h: number, level: number, amplitude: number, seed = 11): RasterImage {
  let state = seed;
  const next = () => ((state = (state * 1103515245 + 12345) >>> 0) / 2 ** 32);
  return raster(w, h, () => Math.round(level + (next() - 0.5) * 2 * amplitude));
}

/** Faint vertical stripes on light paper (period 16 px, ±`amplitude` levels). */
const faintStripes = (level = 225, amplitude = 6, w = 200, h = 120) => raster(w, h, (x) => (Math.floor(x / 8) % 2 ? level + amplitude : level - amplitude));

const scaleOf = (line: VariableWidthLine) => line.spacing / line.parameters.spacing;

function widthStats(line: VariableWidthLine) {
  let min = Infinity, max = -Infinity, sum = 0, sq = 0;
  for (const w of line.widths) {
    min = Math.min(min, w);
    max = Math.max(max, w);
    sum += w;
    sq += w * w;
  }
  const mean = sum / line.widths.length;
  return { min, max, mean, std: Math.sqrt(Math.max(0, sq / line.widths.length - mean * mean)) };
}

/** Mean width of the points whose x lies in [x0, x1) (image px). */
function meanWidthIn(line: VariableWidthLine, x0: number, x1: number): number {
  let sum = 0, n = 0;
  for (let i = 0; i < line.widths.length; i++) {
    const x = line.path.coords[i * 2]!;
    if (x >= x0 && x < x1) {
      sum += line.widths[i]!;
      n++;
    }
  }
  return sum / n;
}

/** Std of the width along the row nearest the middle, where the stripes modulate it. */
function rowModulation(line: VariableWidthLine): number {
  const c = line.path.coords;
  const mid = line.path.bounds.height / 2;
  // Rows are the y values shared by many points (turn points each have their own y).
  const counts = new Map<number, number>();
  for (let i = 1; i < c.length; i += 2) counts.set(c[i]!, (counts.get(c[i]!) ?? 0) + 1);
  let target = Infinity;
  for (const [y, n] of counts) if (n >= 10 && Math.abs(y - mid) < Math.abs(target - mid)) target = y;
  const values: number[] = [];
  for (let i = 0; i < line.widths.length; i++) {
    const x = c[i * 2]!;
    if (c[i * 2 + 1] === target && x > line.spacing && x < line.path.bounds.width - line.spacing) values.push(line.widths[i]!);
  }
  expect(values.length).toBeGreaterThan(10);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

describe('15.1 variable-width line: constant spacing', () => {
  it('rows are exactly `spacing` apart, in light, dark, graded and noisy images alike', () => {
    for (const image of [solid(160, 120, 255), solid(160, 120, 0), gradient(160, 120), noisy(160, 120, 128, 60)]) {
      const line = run(image);
      const s = measureMeanderSpacing(line);
      expect(s.lines).toBe(line.diagnostics.lines);
      expect(s.min).toBeCloseTo(line.spacing, 3);
      expect(s.max).toBeCloseTo(line.spacing, 3);
    }
  });

  it('the centre line does not depend on the image at all: same geometry for black and white', () => {
    const size = { width: 200, height: 150 };
    const p = sanitizeVariableWidthParameters(SMALL).value;
    const a = variableWidthRoute(size, p);
    const b = variableWidthRoute(size, p);
    expect(a.coords).toEqual(b.coords);
    // Different images: only the widths differ, the rows stay where they are.
    const white = run(solid(200, 150, 255)), black = run(solid(200, 150, 0));
    expect(measureMeanderSpacing(white)).toEqual(measureMeanderSpacing(black));
  });

  it('columns: the same spacing, vertically', () => {
    const line = run(gradient(), { route: 'meander-columns' });
    const s = measureMeanderSpacing(line);
    expect(s.lines).toBeGreaterThan(10);
    expect(s.min).toBeCloseTo(line.spacing, 3);
    expect(s.max).toBeCloseTo(line.spacing, 3);
  });

  it('spiral: every point inside the canvas lies on r = spacing · θ / 2π (turns exactly `spacing` apart)', () => {
    const size = { width: 300, height: 200 }, spacing = 5;
    const route = spiral(size, { spacing, start: { x: 0.4, y: 0.6 }, step: 1 });
    const cx = 0.4 * 300, cy = 0.6 * 200;
    let theta = 0, previous = 0, checked = 0;
    for (let i = 1; i < route.frame.length; i++) {
      const x = route.coords[i * 2]! - cx, y = route.coords[i * 2 + 1]! - cy;
      const angle = Math.atan2(y, x);
      let d = angle - previous;
      if (d < -Math.PI) d += 2 * Math.PI;
      if (d > Math.PI) d -= 2 * Math.PI;
      theta += d;
      previous = angle;
      if (route.frame[i]) continue;
      expect(Math.hypot(x, y)).toBeCloseTo((spacing * theta) / (2 * Math.PI), 6);
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

describe('15.1 variable-width line: width follows the tone', () => {
  it('darker ⇒ thicker: along a black→white gradient the width only decreases', () => {
    const line = run(gradient(), { detail: 0, autoLevels: false, contrast: 0 });
    const c = line.path.coords;
    // Straight row segments: width must not grow from dark (left) to light (right).
    for (let i = 1; i < line.widths.length; i++) {
      if (c[i * 2 + 1] !== c[i * 2 - 1]) continue;
      const dx = c[i * 2]! - c[i * 2 - 2]!;
      const dw = line.widths[i]! - line.widths[i - 1]!;
      if (Math.abs(dx) > 0) expect(dw * Math.sign(dx)).toBeLessThanOrEqual(1e-4);
    }
    expect(meanWidthIn(line, 0, 40)).toBeGreaterThan(meanWidthIn(line, 160, 200) * 3);
  });

  it('both transfer curves are continuous, strictly monotonic and hit min/max exactly at white/black', () => {
    for (const curve of ['perceptual', 'linear'] as const) {
      const p = { ...DEFAULT_VARIABLE_WIDTH_PARAMETERS, curve };
      const t = createWidthTransfer(p);
      expect(t(0)).toBeCloseTo(p.maxWidth, 6);
      expect(t(1)).toBeCloseTo(p.minWidth, 6);
      let last = t(0);
      for (let i = 1; i <= 1000; i++) {
        const w = t(i / 1000);
        expect(w).toBeLessThan(last);
        expect(last - w).toBeLessThan(0.02); // no jumps
        last = w;
      }
    }
  });

  it('perceptual curve: light tones get a steeper width response than with the linear curve (light detail)', () => {
    const perceptual = createWidthTransfer({ ...DEFAULT_VARIABLE_WIDTH_PARAMETERS, curve: 'perceptual' });
    const linear = createWidthTransfer({ ...DEFAULT_VARIABLE_WIDTH_PARAMETERS, curve: 'linear' });
    const slope = (t: (l: number) => number, l: number) => (t(l - 0.01) - t(l + 0.01)) / 0.02;
    expect(slope(perceptual, 0.9)).toBeGreaterThan(slope(linear, 0.9) * 1.3);
    // …and the darks a flatter one, so they do not run into solid black.
    expect(slope(perceptual, 0.1)).toBeLessThan(slope(linear, 0.1));
    // On the image: faint light stripes modulate the width more.
    const stripes = faintStripes();
    const p = { detail: 0, autoLevels: false };
    expect(rowModulation(run(stripes, { ...p, curve: 'perceptual' }))).toBeGreaterThan(rowModulation(run(stripes, { ...p, curve: 'linear' })) * 1.3);
  });

  it('min and max width are kept for every route and setting', () => {
    const variants: Partial<VariableWidthParameters>[] = [
      {},
      { route: 'spiral', start: { x: 0.3, y: 0.7 } },
      { route: 'meander-columns', contrast: 1, detail: 2 },
      { curve: 'linear', contrast: -1, smoothing: 0 },
      { spacing: 8, minWidth: 1, maxWidth: 7 },
    ];
    for (const params of variants) {
      const line = run(MOTIFS.portrait(), params);
      const k = scaleOf(line);
      const { min, max } = widthStats(line);
      expect(min).toBeGreaterThanOrEqual(line.parameters.minWidth * k - 1e-5);
      expect(max).toBeLessThanOrEqual(line.parameters.maxWidth * k + 1e-5);
      expect(line.maxWidth).toBeLessThanOrEqual(MAX_WIDTH_SHARE * line.spacing + 1e-9);
      expect(min).toBeGreaterThan(0);
    }
  });

  it('all white ⇒ minimum width everywhere (never 0); all black ⇒ maximum width everywhere', () => {
    const white = run(solid(120, 90, 255));
    const black = run(solid(120, 90, 0));
    for (const w of white.widths) expect(w).toBeCloseTo(white.minWidth, 4);
    for (const w of black.widths) expect(w).toBeCloseTo(black.maxWidth, 4);
    expect(white.minWidth).toBeGreaterThan(0);
    for (const line of [white, black]) expect(validateOneLinePath(line.path).errors).toEqual([]);
  });
});

describe('15.1 variable-width line: one connected path', () => {
  const images = { portrait: MOTIFS.portrait(), landscape: MOTIFS.landscape(), gradient: gradient() };

  for (const route of ['meander-rows', 'meander-columns', 'spiral'] as const) {
    it(`${route}: one valid stroke without jumps, all coordinates finite and inside the canvas`, () => {
      for (const image of Object.values(images)) {
        const line = run(image, { route, start: { x: 0.35, y: 0.6 } });
        const k = scaleOf(line);
        // Longest merged straight run is 32 working px; anything longer would be a jump.
        const report = validateOneLinePath(line.path, { maxSegmentLength: 32 * k + 1e-3, maxZeroLengthShare: 0 });
        expect(report.errors).toEqual([]);
        expect(line.widths.length).toBe(line.path.coords.length / 2);
        for (const v of line.widths) expect(Number.isFinite(v)).toBe(true);
      }
    });
  }

  it('the route itself is built as one polyline: neighbouring samples are about one step (1 px) apart', () => {
    for (const route of ['meander-rows', 'meander-columns', 'spiral'] as const) {
      const p = sanitizeVariableWidthParameters({ ...SMALL, route, start: { x: 0.8, y: 0.2 } }).value;
      const r = variableWidthRoute({ width: 200, height: 133 }, p);
      let longest = 0;
      for (let i = 2; i < r.coords.length; i += 2) longest = Math.max(longest, Math.hypot(r.coords[i]! - r.coords[i - 2]!, r.coords[i + 1]! - r.coords[i - 1]!));
      // The spiral steps by arc length; its chords may exceed the step by a few percent.
      expect(longest, route).toBeLessThanOrEqual(1.05);
    }
  });

  it('meander: turns are semicircles of radius spacing/2 reaching exactly to the border (no loops, no sharp corners)', () => {
    const p = sanitizeVariableWidthParameters(SMALL).value;
    const r = variableWidthRoute({ width: 200, height: 100 }, p);
    let minX = Infinity, maxX = -Infinity, sharpest = 1;
    for (let i = 2; i < r.coords.length - 2; i += 2) {
      minX = Math.min(minX, r.coords[i]!);
      maxX = Math.max(maxX, r.coords[i]!);
      const ax = r.coords[i]! - r.coords[i - 2]!, ay = r.coords[i + 1]! - r.coords[i - 1]!;
      const bx = r.coords[i + 2]! - r.coords[i]!, by = r.coords[i + 3]! - r.coords[i + 1]!;
      sharpest = Math.min(sharpest, (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by)));
    }
    expect(minX).toBeCloseTo(0, 6);
    expect(maxX).toBeCloseTo(200, 6);
    // No direction change above ≈ 23° between neighbouring samples.
    expect(sharpest).toBeGreaterThan(Math.cos(0.4));
  });

  it('identical input ⇒ identical line (bit for bit)', () => {
    for (const route of ['meander-rows', 'spiral'] as const) {
      const a = run(MOTIFS.portrait(), { route, detail: 1.2, contrast: 0.4 });
      const b = run(MOTIFS.portrait(), { route, detail: 1.2, contrast: 0.4 });
      expect(hashBytes(new Uint8Array(a.path.coords.buffer))).toBe(hashBytes(new Uint8Array(b.path.coords.buffer)));
      expect(hashBytes(new Uint8Array(a.widths.buffer))).toBe(hashBytes(new Uint8Array(b.widths.buffer)));
    }
  });

  it('works for very small images (scaled up to the working grid) and extreme aspect ratios', () => {
    for (const [w, h] of [[1, 1], [2, 1], [3, 5], [7, 2], [400, 3]] as const) {
      for (const route of ['meander-rows', 'meander-columns', 'spiral'] as const) {
        const line = run(raster(w, h, (x, y) => ((x + y) % 2 ? 40 : 210)), { route });
        expect(validateOneLinePath(line.path).errors, `${w}×${h} ${route}`).toEqual([]);
        expect(line.path.bounds).toEqual({ width: w, height: h });
      }
    }
    // Smallest working grid with the largest spacing: still one valid line.
    const tiny = generateVariableWidthLine(solid(3, 3, 128), { workingLongEdge: 32, spacing: 40 });
    expect(validateOneLinePath(tiny.path).errors).toEqual([]);
  });
});

describe('15.1 variable-width line: parameters', () => {
  it('spacing sets the number of rows; start picks the corner', () => {
    const image = MOTIFS.landscape();
    const four = run(image, { spacing: 4 }), eight = run(image, { spacing: 8, maxWidth: 7 });
    expect(four.diagnostics.lines).toBe(Math.floor(four.working.height / 4));
    expect(eight.diagnostics.lines).toBe(Math.floor(eight.working.height / 8));
    const { width: W, height: H } = four.path.bounds;
    for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const line = run(image, { start: { x: sx, y: sy } });
      const [x, y] = [line.path.coords[0]!, line.path.coords[1]!];
      expect(Math.abs(x - sx * W)).toBeLessThan(line.spacing);
      expect(Math.abs(y - sy * H)).toBeLessThan(line.spacing);
    }
    const centre = run(image, { route: 'spiral', start: { x: 0.25, y: 0.5 } });
    expect(centre.path.coords[0]).toBeCloseTo(0.25 * W, 3);
    expect(centre.path.coords[1]).toBeCloseTo(0.5 * H, 3);
  });

  it('min/max width, contrast and curve change the widths as intended', () => {
    const image = gradient();
    const base = widthStats(run(image, { detail: 0 }));
    const narrow = run(image, { detail: 0, minWidth: 1, maxWidth: 2 });
    const ns = widthStats(narrow);
    // The smoothed edge columns are not quite pure black / white.
    expect(ns.min).toBeCloseTo(narrow.minWidth, 2);
    expect(ns.max).toBeCloseTo(narrow.maxWidth, 2);
    expect(widthStats(run(image, { detail: 0, contrast: 1 })).std).toBeGreaterThan(base.std);
    expect(widthStats(run(image, { detail: 0, contrast: -0.8 })).std).toBeLessThan(base.std);
    expect(widthStats(run(image, { detail: 0, curve: 'linear' })).mean).not.toBeCloseTo(base.mean, 2);
  });

  it('contrast curve: identity at 0, S-curve above, compression below; always monotonic within 0…1', () => {
    for (const t of [0, 0.2, 0.5, 0.9, 1]) expect(contrastCurve(t, 0)).toBeCloseTo(t, 12);
    expect(contrastCurve(0.8, 0.7)).toBeGreaterThan(0.8);
    expect(contrastCurve(0.8, -0.5)).toBeLessThan(0.8);
    for (const c of [-1, -0.3, 0.3, 1]) {
      let last = -Infinity;
      for (let i = 0; i <= 100; i++) {
        const v = contrastCurve(i / 100, c);
        expect(v).toBeGreaterThanOrEqual(last);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        last = v;
      }
    }
  });

  it('detail boost strengthens real faint structure but hardly amplifies sensor noise', () => {
    const p = { autoLevels: false, smoothing: 0.35 };
    const stripes = faintStripes(215, 8);
    expect(rowModulation(run(stripes, { ...p, detail: 1.5 }))).toBeGreaterThan(rowModulation(run(stripes, { ...p, detail: 0 })) * 1.3);
    const noise = noisy(200, 120, 200, 4);
    const quiet = widthStats(run(noise, { ...p, detail: 0 })).std;
    expect(widthStats(run(noise, { ...p, detail: 1.5 })).std).toBeLessThan(quiet * 1.25 + 1e-3);
  });

  it('smoothing evens out the width; 0 keeps the finest variation', () => {
    const image = noisy(200, 120, 128, 50);
    const sharp = widthStats(run(image, { detail: 0, smoothing: 0 })).std;
    const soft = widthStats(run(image, { detail: 0, smoothing: 1 })).std;
    expect(soft).toBeLessThan(sharp * 0.6);
  });

  it('sanitizing: widths are kept apart and below the spacing; nothing is silently wrong', () => {
    const merged = sanitizeVariableWidthParameters({ spacing: 4, maxWidth: 10, minWidth: 0 });
    expect(merged.value.maxWidth).toBeCloseTo(MAX_WIDTH_SHARE * 4, 9);
    expect(merged.value.minWidth).toBeGreaterThan(0);
    expect(merged.issues.map((i) => i.name)).toEqual(expect.arrayContaining(['maxWidth', 'minWidth']));
    const swapped = sanitizeVariableWidthParameters({ minWidth: 3, maxWidth: 2 });
    expect(swapped.value.minWidth).toBeLessThan(swapped.value.maxWidth);
    const invalid = sanitizeVariableWidthParameters({ spacing: Number.NaN, detail: 99, start: { x: 2, y: -1 } });
    expect(invalid.value.spacing).toBe(DEFAULT_VARIABLE_WIDTH_PARAMETERS.spacing);
    expect(invalid.value.detail).toBe(2);
    expect(invalid.value.start).toEqual({ x: 1, y: 0 });
    expect(sanitizeVariableWidthParameters({}).issues).toEqual([]);
    expect(() => sanitizeVariableWidthParameters({ route: 'zigzag' as never })).toThrow(RangeError);
  });
});

describe('15.1 variable-width line: drawing and measurement', () => {
  it('the outline is one closed shape (both edges + two caps), finite; the SVG holds exactly one path', () => {
    const line = run(MOTIFS.portrait());
    const outline = variableWidthOutline(line.path.coords, line.widths);
    expect(outline.length).toBe((2 * line.widths.length + 10) * 2);
    for (const v of outline) expect(Number.isFinite(v)).toBe(true);
    const svg = variableWidthSvg(line, { longEdge: 600 });
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg.match(/M/g)).toHaveLength(1);
  });

  it('comparison metrics: a perfect copy has no tone error and full detail', () => {
    const line = run(MOTIFS.portrait());
    const field = { width: 64, height: 48, data: Float32Array.from({ length: 64 * 48 }, (_, i) => ((i * 37) % 97) / 97) };
    const same = compareRendering(field, field, 2);
    for (const band of [same.light, same.mid, same.dark]) {
      expect(band.toneError).toBe(0);
      if (band.share > 0.05) {
        expect(band.detailCorrelation).toBeCloseTo(1, 6);
        expect(band.detailGain).toBeCloseTo(1, 6);
      }
    }
    expect(line.diagnostics.points).toBeLessThan(line.diagnostics.routePoints);
  });
});
