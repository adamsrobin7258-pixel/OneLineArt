import { describe, expect, it } from 'vitest';
import {
  DRAWING_STYLE_PROFILES,
  ORTHOGONAL_ENGINE_ID,
  analyzeImage,
  computePathMetrics,
  createRandom,
  hashBytes,
  latticePoints,
  mergeOrthogonalRuns,
  oneLineEngine,
  orthogonalRoute,
  removeOrthogonalJogs,
  resolveOneLineSettings,
  toSvgPathData,
  validateOneLinePath,
  type DrawingStyle,
  type OneLinePath,
  type RasterImage,
  type ScalarField,
} from '../../../src/core';
import { raster } from '../../fixtures/rasters';
import { MOTIFS, portrait } from '../../fixtures/scenes';
import { TEST_PARAMETERS, lengthDensity } from './helpers';

const hashOf = (p: OneLinePath) => hashBytes(new Uint8Array(p.coords.buffer, p.coords.byteOffset, p.coords.byteLength));

function runStyle(style: DrawingStyle, image: RasterImage, seed = 3, detailLevel: 'minimal' | 'balanced' | 'detail' = 'balanced') {
  const analysis = analyzeImage(image, undefined, 'img-ortho');
  const effective = resolveOneLineSettings({ style, seed, detailLevel }, TEST_PARAMETERS);
  return oneLineEngine(effective.engineId).run({ image, analysis, settings: effective.settings }, effective.parameters, { rng: createRandom(seed) });
}

/** Every segment of a polyline (interleaved x/y): exactly horizontal or vertical, never zero-length. */
function nonOrthogonalSegments(coords: ArrayLike<number>): number {
  let bad = 0;
  for (let i = 2; i < coords.length; i += 2) {
    const dx = coords[i]! - coords[i - 2]!, dy = coords[i + 1]! - coords[i - 1]!;
    if ((dx !== 0 && dy !== 0) || (dx === 0 && dy === 0)) bad++;
  }
  return bad;
}

/** Share of vertices where the line turns back on itself (180°). */
function reversalShare(coords: ArrayLike<number>): number {
  let reversals = 0;
  const n = coords.length / 2;
  for (let i = 1; i < n - 1; i++) {
    const ax = coords[i * 2]! - coords[i * 2 - 2]!, ay = coords[i * 2 + 1]! - coords[i * 2 - 1]!;
    const bx = coords[i * 2 + 2]! - coords[i * 2]!, by = coords[i * 2 + 3]! - coords[i * 2 + 1]!;
    if (ax * bx + ay * by < 0 && ax * by - ay * bx === 0) reversals++;
  }
  return reversals / Math.max(1, n - 2);
}

describe('orthogonal routing', () => {
  it('turns every connection into horizontal/vertical legs, keeping every vertex in order', () => {
    const input = new Float64Array([0, 0, 10, 3, 4, 9, 4, 20, -5, 11, -5, 11, 7, 11]);
    const out = orthogonalRoute(input);
    expect(nonOrthogonalSegments(mergeOrthogonalRuns(out))).toBe(0);
    let from = 0;
    for (let i = 0; i < input.length; i += 2) {
      let found = -1;
      for (let j = from; j < out.length; j += 2) {
        if (out[j] === input[i] && out[j + 1] === input[i + 1]) {
          found = j;
          break;
        }
      }
      expect(found).toBeGreaterThanOrEqual(0);
      from = found;
    }
  });

  it('corners lie in the box of their connection (the line never leaves the canvas); drawn length = Manhattan length', () => {
    const input = new Float64Array([1, 1, 9, 4, 2, 8, 8, 8, 3, 2]);
    const out = orthogonalRoute(input);
    let length = 0, manhattan = 0;
    for (let i = 2; i < out.length; i += 2) length += Math.abs(out[i]! - out[i - 2]!) + Math.abs(out[i + 1]! - out[i - 1]!);
    for (let i = 2; i < input.length; i += 2) manhattan += Math.abs(input[i]! - input[i - 2]!) + Math.abs(input[i + 1]! - input[i - 1]!);
    expect(length).toBeCloseTo(manhattan, 9);
    for (let i = 0; i < out.length; i += 2) {
      expect(out[i]).toBeGreaterThanOrEqual(1);
      expect(out[i]).toBeLessThanOrEqual(9);
      expect(out[i + 1]).toBeGreaterThanOrEqual(1);
      expect(out[i + 1]).toBeLessThanOrEqual(8);
    }
  });

  it('chooses the corners for as few turns as possible: a staircase keeps running straight through its points', () => {
    // → then ↓: horizontal-first continues the incoming horizontal leg.
    const out = mergeOrthogonalRuns(orthogonalRoute(new Float64Array([0, 0, 5, 0, 10, 5])));
    expect(Array.from(out)).toEqual([0, 0, 10, 0, 10, 5]);
    // ↓ then →: vertical-first continues the incoming vertical leg.
    expect(Array.from(mergeOrthogonalRuns(orthogonalRoute(new Float64Array([0, 0, 0, 5, 5, 10]))))).toEqual([0, 0, 0, 10, 5, 10]);
  });

  it('avoids running back over itself (180°) whenever the other corner allows it', () => {
    // A→B right, B→C back left and down: horizontal-first would draw ← over →.
    const out = orthogonalRoute(new Float64Array([0, 0, 10, 0, 4, 6]));
    expect(reversalShare(out)).toBe(0);
    expect(nonOrthogonalSegments(out)).toBe(0);
  });

  it('removes steps smaller than the tolerance but keeps U-turns; stays exactly orthogonal', () => {
    // → (step ↓ 0.5) → ↓ : the small step goes, the rest continues on the first line.
    const jog = new Float64Array([0, 0, 5, 0, 5, 0.5, 10, 0.5, 10, 6]);
    expect(Array.from(removeOrthogonalJogs(jog, 1))).toEqual([0, 0, 10, 0, 10, 6]);
    // A U-turn (→ ↓ ←) is shape, not a step.
    const u = new Float64Array([0, 0, 5, 0, 5, 0.5, 0, 0.5]);
    expect(Array.from(removeOrthogonalJogs(u, 1))).toEqual(Array.from(u));
    // Steps at least as large as the tolerance stay.
    expect(Array.from(removeOrthogonalJogs(jog, 0.5))).toEqual(Array.from(jog));
  });

  it('never joins a straight run beyond the longest allowed segment (a long run is not a jump)', () => {
    const run = new Float64Array([0, 0, 10, 0, 20, 0, 30, 0, 40, 0]);
    expect(Array.from(mergeOrthogonalRuns(run))).toEqual([0, 0, 40, 0]);
    const limited = mergeOrthogonalRuns(run, 25);
    for (let i = 2; i < limited.length; i += 2) expect(Math.abs(limited[i]! - limited[i - 2]!)).toBeLessThanOrEqual(25);
    expect(limited[0]).toBe(0);
    expect(limited[limited.length - 2]).toBe(40);
  });
});

describe('lattice points', () => {
  const field = (w: number, h: number, f: (x: number, y: number) => number): ScalarField => {
    const data = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x, y);
    return { width: w, height: h, data };
  };

  it('about the requested number of points, all distinct, on few shared rows and columns; denser where demand is higher', () => {
    const demand = field(120, 80, (x) => (x < 60 ? 1 : 0.2));
    const { xs, ys } = latticePoints(demand, 1500);
    expect(xs.length).toBeGreaterThan(1500 * 0.9);
    expect(xs.length).toBeLessThan(1500 * 1.1);
    const keys = new Set(Array.from(xs, (x, i) => `${x},${ys[i]}`));
    expect(keys.size).toBe(xs.length);
    // On a lattice: far fewer distinct x / y values than points.
    expect(new Set(xs).size).toBeLessThan(xs.length / 10);
    expect(new Set(ys).size).toBeLessThan(ys.length / 10);
    const left = Array.from(xs).filter((x) => x < 60).length;
    expect(left / (xs.length - left)).toBeGreaterThan(3.5);
  });

  it('is deterministic and stays inside the grid', () => {
    const demand = field(90, 70, (x, y) => 0.05 + ((x * 7 + y * 3) % 11) / 11);
    const a = latticePoints(demand, 800), b = latticePoints(demand, 800);
    expect(Array.from(a.xs)).toEqual(Array.from(b.xs));
    expect(Array.from(a.ys)).toEqual(Array.from(b.ys));
    for (let i = 0; i < a.xs.length; i++) {
      expect(a.xs[i]).toBeGreaterThanOrEqual(0);
      expect(a.xs[i]).toBeLessThanOrEqual(90);
      expect(a.ys[i]).toBeGreaterThanOrEqual(0);
      expect(a.ys[i]).toBeLessThanOrEqual(70);
    }
  });

  it('always returns at least two points (a line needs two)', () => {
    expect(latticePoints(field(10, 10, () => 0), 0).xs.length).toBeGreaterThanOrEqual(2);
    expect(latticePoints(field(1, 1, () => 1), 1).xs.length).toBeGreaterThanOrEqual(2);
  });
});

describe('orthogonal style', () => {
  it('is its own engine, registered like the other styles, without smoothing', () => {
    expect(DRAWING_STYLE_PROFILES.orthogonal).toEqual({ engineId: ORTHOGONAL_ENGINE_ID, parameters: {}, smoothing: false });
    const e = resolveOneLineSettings({ style: 'orthogonal' });
    expect(e.engineId).toBe(ORTHOGONAL_ENGINE_ID);
    expect(e.key).not.toBe(resolveOneLineSettings({ style: 'organic' }).key);
    expect(e.key).not.toBe(resolveOneLineSettings({ style: 'geometric' }).key);
  });

  for (const [name, make] of Object.entries(MOTIFS)) {
    for (const level of ['minimal', 'balanced', 'detail'] as const) {
      it(`${name} / ${level}: ONE valid line with only horizontal and vertical segments (geometric check, no diagonals)`, () => {
        const image = make();
        const { path, demand } = runStyle('orthogonal', image, 3, level);
        expect(path.meta.generatorId).toBe(ORTHOGONAL_ENGINE_ID);
        expect(validateOneLinePath(path).errors).toEqual([]);
        expect(toSvgPathData(path).match(/M/g)).toHaveLength(1);
        // Exact check on the stored float32 coordinates: every segment has dx = 0 or dy = 0.
        expect(nonOrthogonalSegments(path.coords)).toBe(0);
        // Corners are 90°: turning back on itself stays a rare exception.
        expect(reversalShare(path.coords)).toBeLessThan(0.05);
        // Reaches the image about as well as the organic line (sparse areas are drawn with fewer, longer legs).
        const m = computePathMetrics(path, { demand, coverageCells: 16 });
        const organic = runStyle('organic', image, 3, level);
        const organicCovered = computePathMetrics(organic.path, { demand: organic.demand, coverageCells: 16 }).coverage!.demandCovered;
        expect(m.coverage!.demandCovered).toBeGreaterThan(organicCovered - 0.25);
        expect(m.boundingBox.maxX - m.boundingBox.minX).toBeGreaterThan(image.width * 0.85);
        expect(m.boundingBox.maxY - m.boundingBox.minY).toBeGreaterThan(image.height * 0.85);
      });
    }
  }

  it('is deterministic: same image and settings ⇒ identical path', () => {
    const image = portrait();
    const a = runStyle('orthogonal', image).path;
    expect(hashOf(runStyle('orthogonal', image).path)).toBe(hashOf(a));
  });

  it('is its own path computation, not a reshaped organic path: different points and route', () => {
    const image = portrait();
    const organic = runStyle('organic', image).path;
    const orthogonal = runStyle('orthogonal', image).path;
    expect(orthogonal.bounds).toEqual(organic.bounds);
    // The organic line has (almost) no axis-parallel segments; the orthogonal one only those.
    expect(nonOrthogonalSegments(organic.coords) / (organic.coords.length / 2)).toBeGreaterThan(0.9);
    // Its vertices lie on lattice rows and columns: far fewer distinct coordinates than vertices.
    const n = orthogonal.coords.length / 2;
    const ys = new Set<number>();
    for (let i = 1; i < orthogonal.coords.length; i += 2) ys.add(orthogonal.coords[i]!);
    expect(ys.size).toBeLessThan(n / 5);
  });

  it('follows the image: more line in dark areas than in light ones; detail levels keep their meaning', () => {
    const image = raster(320, 240, (x) => (x < 160 ? 40 : 235));
    const { path } = runStyle('orthogonal', image);
    expect(lengthDensity(path, 10, 10, 150, 230)).toBeGreaterThan(1.5 * lengthDensity(path, 170, 10, 310, 230));
    const length = (p: OneLinePath) => computePathMetrics(p).length;
    const [minimal, balanced, detail] = (['minimal', 'balanced', 'detail'] as const).map((level) => length(runStyle('orthogonal', portrait(), 3, level).path));
    expect(minimal).toBeLessThan(balanced!);
    expect(balanced).toBeLessThan(detail!);
  });

  it('respects maxPoints (the tolerance is coarsened like in the other styles)', () => {
    const image = MOTIFS.structured();
    const analysis = analyzeImage(image, undefined, 'img-ortho');
    const effective = resolveOneLineSettings({ style: 'orthogonal', seed: 3, detailLevel: 'detail' }, TEST_PARAMETERS, 300);
    const { path } = oneLineEngine(effective.engineId).run({ image, analysis, settings: effective.settings }, effective.parameters, { rng: createRandom(3) });
    expect(path.coords.length / 2).toBeLessThanOrEqual(300);
    expect(nonOrthogonalSegments(path.coords)).toBe(0);
    expect(validateOneLinePath(path).errors).toEqual([]);
  });

  it('returns the same OneLinePath format as the other styles', () => {
    const { path } = runStyle('orthogonal', portrait());
    expect(path.coords).toBeInstanceOf(Float32Array);
    expect(Object.keys(path).sort()).toEqual(['bounds', 'coords', 'meta']);
    expect(Object.keys(path.meta).sort()).toEqual(['generatorId', 'generatorVersion', 'seed', 'sourceImageId']);
  });
});
