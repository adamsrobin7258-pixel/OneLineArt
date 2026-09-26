import { describe, expect, it } from 'vitest';
import { hashBytes, validateOneLinePath, type RasterImage } from '../../../src/core';
import {
  DEFAULT_VARIABLE_WIDTH_PARAMETERS,
  MAX_WIDTH_SHARES,
  createWidthTransfer,
  generateVariableWidthLine,
  measureLineGeometry,
  sanitizeVariableWidthParameters,
  variableWidthRoute,
  type VariableWidthLine,
  type VariableWidthParameters,
  type VariableWidthRoute,
} from '../../../src/core/experimental/variableWidth';
import { raster, solid } from '../../fixtures/rasters';
import { MOTIFS } from '../../fixtures/scenes';

/** Phase 15.2 routes; the tests use a small working grid (the geometry is resolution-independent). */
const CURVED: readonly VariableWidthRoute[] = ['arc-spiral', 'organic-meander', 'flow'];
const SMALL: Partial<VariableWidthParameters> = { workingLongEdge: 240 };
const run = (image: RasterImage, p: Partial<VariableWidthParameters> = {}) => generateVariableWidthLine(image, { ...SMALL, ...p });
const hashOf = (a: Float32Array) => hashBytes(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));

/** Seeded ±amplitude noise. */
function noisy(w: number, h: number, level: number, amplitude: number, seed = 5): RasterImage {
  let state = seed;
  const next = () => (state = (state * 1103515245 + 12345) >>> 0) / 2 ** 32;
  return raster(w, h, () => Math.round(level + (next() - 0.5) * 2 * amplitude));
}

const meanWidth = (l: VariableWidthLine) => l.widths.reduce((a, b) => a + b, 0) / l.widths.length;

describe('15.2 reference: the Phase 15.1 routes are unchanged (bit for bit)', () => {
  // Hashes computed with the Phase 15.1 commit (7ff48fd) on the same inputs.
  const reference = [
    ['default', {}, 'a5e4a1a4', 'e6a5eb31'],
    ['small', { workingLongEdge: 200 }, '8506fde3', '06d7ea3c'],
    ['columns', { workingLongEdge: 300, route: 'meander-columns', start: { x: 1, y: 1 } }, '757e7193', '4bb09269'],
    ['spiral', { workingLongEdge: 300, route: 'spiral', start: { x: 0.3, y: 0.6 } }, '3482933a', '6c7ba4ce'],
  ] as const;
  for (const [name, params, coords, widths] of reference) {
    it(`${name}: identical centre line and widths`, () => {
      const line = generateVariableWidthLine(MOTIFS.portrait(), params as Partial<VariableWidthParameters>);
      expect(hashOf(line.path.coords)).toBe(coords);
      expect(hashOf(line.widths)).toBe(widths);
    });
  }
});

describe('15.2 curved routes: one valid line, deterministic, inside the canvas', () => {
  for (const route of CURVED) {
    it(`${route}: deterministic, one connected stroke, finite coordinates inside the canvas`, () => {
      for (const image of [MOTIFS.portrait(), MOTIFS.landscape(), MOTIFS.architecture()]) {
        const a = run(image, { route, start: { x: 0.2, y: 0.8 } });
        const b = run(image, { route, start: { x: 0.2, y: 0.8 } });
        expect(hashOf(a.path.coords)).toBe(hashOf(b.path.coords));
        expect(hashOf(a.widths)).toBe(hashOf(b.widths));
        const k = a.spacing / a.parameters.spacing;
        // Longest merged straight run is 32 working px; anything longer would be a jump.
        expect(validateOneLinePath(a.path, { maxSegmentLength: 32 * k + 1e-3, maxZeroLengthShare: 0, boundsTolerance: 0 }).errors).toEqual([]);
        for (const v of a.path.coords) expect(Number.isFinite(v)).toBe(true);
        for (const v of a.widths) expect(Number.isFinite(v) && v > 0).toBe(true);
        // The geometry holds: no row split into pieces, no cusp.
        expect(a.diagnostics.curved).not.toBeNull();
        expect(a.diagnostics.curved!.splitRows).toBe(0);
        expect(a.diagnostics.curved!.cusps).toBe(0);
        expect(a.diagnostics.frameShare).toBe(0);
      }
    });

    it(`${route}: the route itself is sampled finely (no jumps before merging)`, () => {
      const p = sanitizeVariableWidthParameters({ ...SMALL, route }).value;
      const r = variableWidthRoute({ width: 240, height: 180 }, p);
      let longest = 0;
      for (let i = 2; i < r.coords.length; i += 2) longest = Math.max(longest, Math.hypot(r.coords[i]! - r.coords[i - 2]!, r.coords[i + 1]! - r.coords[i - 1]!));
      expect(longest).toBeLessThanOrEqual(1.5);
    });
  }

  it('very small and extreme canvases still give one valid line', () => {
    for (const [w, h] of [[1, 1], [3, 5], [400, 3], [20, 300]] as const) {
      for (const route of CURVED) {
        const line = run(raster(w, h, (x, y) => ((x + y) % 2 ? 40 : 210)), { route });
        expect(validateOneLinePath(line.path).errors, `${w}×${h} ${route}`).toEqual([]);
      }
    }
  });
});

describe('15.2 spacing (measured on the drawn line)', () => {
  const image = solid(320, 240, 128);

  // Realistic working grid: on very small grids the oblique turns are a larger share of the line
  // (their wedge-shaped gaps raise the upper tail, e.g. 95 % at 4.6 px for a 320 px grid).
  it('arc spiral and flowing curve keep the spacing exactly (5–95 % of all points within ±1 %)', () => {
    for (const route of ['arc-spiral', 'flow'] as const) {
      for (const [spacing, edge] of [[4, 600], [6, 900]] as const) {
        const g = measureLineGeometry(run(image, { route, spacing, maxWidth: spacing * 0.8, workingLongEdge: edge }));
        expect(g.spacing.p05, `${route} ${spacing}`).toBeGreaterThanOrEqual(0.99 * spacing);
        expect(g.spacing.p95, `${route} ${spacing}`).toBeLessThanOrEqual(1.01 * spacing);
        expect(Math.abs(g.spacing.mean - spacing) / spacing).toBeLessThan(0.03);
      }
    }
  });

  it('organic meander: an approximation — within ±13 % at full bend, closer with less bend (documented)', () => {
    const full = measureLineGeometry(run(image, { route: 'organic-meander', bend: 1, workingLongEdge: 320 }));
    expect(full.spacing.p05).toBeGreaterThanOrEqual(0.87 * 4);
    expect(full.spacing.p95).toBeLessThanOrEqual(1.13 * 4);
    const half = measureLineGeometry(run(image, { route: 'organic-meander', bend: 0.5, workingLongEdge: 320 }));
    expect(half.spacing.std).toBeLessThan(full.spacing.std);
    const none = measureLineGeometry(run(image, { route: 'organic-meander', bend: 0, workingLongEdge: 320 }));
    expect(none.spacing.p05).toBeGreaterThanOrEqual(0.99 * 4);
    expect(none.spacing.p95).toBeLessThanOrEqual(1.01 * 4);
  });

  it('the reference meander measures exactly 4 px with the same metric', () => {
    const g = measureLineGeometry(run(image, { workingLongEdge: 320 }));
    expect(g.spacing.p05).toBeCloseTo(4, 3);
    expect(g.spacing.p95).toBeCloseTo(4, 3);
    expect(g.overlapShare).toBe(0);
  });

  it('changing the spacing changes the geometry reproducibly', () => {
    for (const route of CURVED) {
      const four = run(image, { route, spacing: 4 });
      const six = run(image, { route, spacing: 6, maxWidth: 5 });
      expect(six.diagnostics.lines).toBeLessThan(four.diagnostics.lines);
      expect(hashOf(run(image, { route, spacing: 6, maxWidth: 5 }).path.coords)).toBe(hashOf(six.path.coords));
    }
  });
});

describe('15.2 the image never moves the line', () => {
  const black = solid(240, 180, 0), white = solid(240, 180, 255), noise = noisy(240, 180, 128, 120), portrait = MOTIFS.portrait(240, 180);

  for (const route of ['meander-rows', ...CURVED] as const) {
    it(`${route}: completely different images give the same centre line; only the widths differ`, () => {
      const p = sanitizeVariableWidthParameters({ ...SMALL, route }).value;
      const lines = [black, white, noise, portrait].map((img) => run(img, { route }));
      // Every drawn point is a point of the ONE image-independent route (merging only drops points).
      const size = lines[0]!.working;
      const route0 = variableWidthRoute(size, p);
      const k = lines[0]!.spacing / lines[0]!.parameters.spacing;
      const onRoute = new Set<string>();
      for (let i = 0; i < route0.coords.length; i += 2) onRoute.add(`${Math.fround(route0.coords[i]! * k)},${Math.fround(route0.coords[i + 1]! * k)}`);
      for (const line of lines) {
        const c = line.path.coords;
        for (let i = 0; i < c.length; i += 2) expect(onRoute.has(`${c[i]},${c[i + 1]}`)).toBe(true);
        // Same start and end: the same line.
        expect([c[0], c[1], c[c.length - 2], c[c.length - 1]]).toEqual([...lines[0]!.path.coords.slice(0, 2), ...lines[0]!.path.coords.slice(-2)]);
      }
      // The widths follow the images.
      expect(meanWidth(lines[0]!)).toBeGreaterThan(meanWidth(lines[1]!) * 3);
      expect(hashOf(lines[2]!.widths)).not.toBe(hashOf(lines[3]!.widths));
    });
  }
});

describe('15.2 start point', () => {
  const image = MOTIFS.landscape(320, 220);
  const corners = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const;

  for (const route of CURVED) {
    it(`${route}: the line begins at the corner nearest to the start point`, () => {
      for (const [sx, sy] of corners) {
        const line = run(image, { route, start: { x: sx * 0.9 + 0.05, y: sy * 0.9 + 0.05 } });
        const { width: W, height: H } = line.path.bounds;
        const [x, y] = [line.path.coords[0]!, line.path.coords[1]!];
        expect(Math.hypot(x - sx * W, y - sy * H), `${route} ${sx},${sy}`).toBeLessThan(0.1 * Math.hypot(W, H));
      }
    });

    it(`${route}: the start moves only the line — same tone field, similar length and spacing`, () => {
      const a = run(image, { route, start: { x: 0, y: 0 } });
      const b = run(image, { route, start: { x: 1, y: 1 } });
      expect(a.diagnostics.levels).toEqual(b.diagnostics.levels);
      expect(a.diagnostics.noiseSigma).toBe(b.diagnostics.noiseSigma);
      expect(Math.abs(a.diagnostics.length - b.diagnostics.length) / a.diagnostics.length).toBeLessThan(0.03);
      expect(hashOf(a.path.coords)).not.toBe(hashOf(b.path.coords));
    });
  }

  it('arc spiral: the opposite corner gives the point-mirrored route (only the position changes)', () => {
    const size = { width: 300, height: 200 };
    const p = (x: number, y: number) => sanitizeVariableWidthParameters({ route: 'arc-spiral', start: { x, y } }).value;
    const a = variableWidthRoute(size, p(0, 0)).coords;
    const b = variableWidthRoute(size, p(1, 1)).coords;
    // Every point of b, mirrored through the centre, lies on a (within half a sample step).
    const cells = new Map<string, number[]>();
    for (let i = 0; i < a.length; i += 2) {
      const key = `${Math.floor(a[i]!)},${Math.floor(a[i + 1]!)}`;
      cells.set(key, [...(cells.get(key) ?? []), i]);
    }
    let worst = 0;
    for (let i = 0; i < b.length; i += 2) {
      const x = 300 - b[i]!, y = 200 - b[i + 1]!;
      let best = Infinity;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const j of cells.get(`${Math.floor(x) + dx},${Math.floor(y) + dy}`) ?? []) best = Math.min(best, Math.hypot(a[j]! - x, a[j + 1]! - y));
        }
      }
      worst = Math.max(worst, best);
    }
    // Turn cuts are found on the sample grid, so the two sides may differ by a sample step.
    expect(worst).toBeLessThan(1);
    expect(Math.abs(b.length - a.length)).toBeLessThanOrEqual(8);
  });

  it('arc spiral: the centre distance only bends the arcs (0 = at the corner, larger = flatter)', () => {
    const image2 = solid(320, 240, 128);
    const near = run(image2, { route: 'arc-spiral', arcCenter: 0, workingLongEdge: 600 });
    const far = run(image2, { route: 'arc-spiral', arcCenter: 2, workingLongEdge: 600 });
    expect(hashOf(near.path.coords)).not.toBe(hashOf(far.path.coords));
    for (const l of [near, far]) {
      const g = measureLineGeometry(l);
      expect(g.spacing.p05).toBeGreaterThanOrEqual(0.99 * 4);
      expect(g.spacing.p95).toBeLessThanOrEqual(1.01 * 4);
    }
  });
});

describe('15.2 width may exceed the spacing (experiment)', () => {
  it('safe mode keeps the Phase 15.1 limit; controlled and free allow 120 % / 200 %', () => {
    expect(MAX_WIDTH_SHARES).toEqual({ safe: 0.9, controlled: 1.2, free: 2 });
    expect(sanitizeVariableWidthParameters({ maxWidth: 10 }).value.maxWidth).toBeCloseTo(3.6, 9);
    expect(sanitizeVariableWidthParameters({ maxWidth: 10, widthMode: 'controlled' }).value.maxWidth).toBeCloseTo(4.8, 9);
    expect(sanitizeVariableWidthParameters({ maxWidth: 10, widthMode: 'free' }).value.maxWidth).toBeCloseTo(8, 9);
    expect(sanitizeVariableWidthParameters({}).value.widthMode).toBe('safe');
    expect(() => sanitizeVariableWidthParameters({ widthMode: 'wild' as never })).toThrow(RangeError);
  });

  it('beyond the safe maximum the transfer stays continuous and monotonic and only the darkest tones get thicker', () => {
    for (const curve of ['perceptual', 'linear'] as const) {
      const safe = createWidthTransfer({ ...DEFAULT_VARIABLE_WIDTH_PARAMETERS, curve, maxWidth: 3.6 });
      const over = createWidthTransfer({ ...DEFAULT_VARIABLE_WIDTH_PARAMETERS, curve, maxWidth: 4.8 });
      expect(over(0)).toBeCloseTo(4.8, 6);
      let last = over(0);
      for (let i = 1; i <= 1000; i++) {
        const l = i / 1000;
        const w = over(l);
        expect(w).toBeLessThan(last + 1e-12);
        expect(last - w).toBeLessThan(0.05);
        last = w;
        // Lighter than the dark range: exactly the safe curve.
        if (l >= 0.35) expect(w).toBe(safe(l));
      }
    }
  });

  it('on a dark image the line overlaps its neighbours only in the overlap modes', () => {
    const dark = solid(240, 180, 20);
    const safe = measureLineGeometry(run(dark, { maxWidth: 3.6 }));
    const controlled = measureLineGeometry(run(dark, { widthMode: 'controlled', maxWidth: 4.6 }));
    expect(safe.overlapShare).toBe(0);
    expect(controlled.overlapShare).toBeGreaterThan(0.5);
    expect(controlled.width.max).toBeGreaterThan(4);
  });
});
