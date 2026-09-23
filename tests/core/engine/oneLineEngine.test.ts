import { describe, expect, it } from 'vitest';
import {
  EngineError,
  analyzeImage,
  computePathMetrics,
  createRandom,
  endPoint,
  generateOneLine,
  hashBytes,
  pathLength,
  pointCount,
  renderSvg,
  startPoint,
  toSvgPathData,
  uniformAnalyzer,
  validateOneLinePath,
  DEFAULT_ONE_LINE_SETTINGS,
  DEFAULT_RENDER_STYLE,
  createTimeline,
  DEFAULT_ENGINE_PARAMETERS,
  type OneLinePath,
} from '../../../src/core';
import { raster } from '../../fixtures/rasters';
import { MOTIFS, objectOnPlain, strongRectangle, nearlyUniform } from '../../fixtures/scenes';
import { TEST_PARAMETERS, lengthDensity, run } from './helpers';

function expectOneValidLine(path: OneLinePath) {
  const report = validateOneLinePath(path, { maxSegmentLength: Math.hypot(path.bounds.width, path.bounds.height) * 0.2 });
  expect(report.errors).toEqual([]);
  // One stroke: exactly one "M" in the SVG path data.
  expect(toSvgPathData(path).match(/M/g)).toHaveLength(1);
  const c = path.coords;
  for (let i = 0; i < c.length; i += 2) {
    if (!(Number.isFinite(c[i]) && Number.isFinite(c[i + 1]))) throw new Error(`non-finite at ${i / 2}`);
    if (c[i]! < 0 || c[i]! > path.bounds.width || c[i + 1]! < 0 || c[i + 1]! > path.bounds.height) throw new Error(`outside at ${i / 2}`);
  }
  expect(pathLength(path)).toBeGreaterThan(0);
}

describe('One-Line engine on motif categories', () => {
  for (const [name, make] of Object.entries(MOTIFS)) {
    it(`${name}: one valid, connected, in-bounds line that covers the canvas`, () => {
      const image = make();
      const { path, demand } = run(image);
      expectOneValidLine(path);
      expect(path.bounds).toEqual({ width: image.width, height: image.height });
      // Coarse 16-cell grid: does the line take part in every region of the canvas?
      // (Finer grids would rightly show sparse background cells: empty areas are not filled.)
      const metrics = computePathMetrics(path, { demand, coverageCells: 16 });
      const cov = metrics.coverage!;
      const meanTarget = cov.target.reduce((a, b) => a + b, 0) / cov.target.length;
      // No region with meaningful demand is left out; low-demand areas may stay sparse.
      cov.states.forEach((state, i) => {
        if (cov.target[i]! >= meanTarget * 0.5) expect(state, `cell ${i}`).not.toBe('untouched');
      });
      expect(cov.counts.untouched / cov.states.length).toBeLessThan(0.25);
      expect(cov.demandCovered).toBeGreaterThan(0.85);
      // Line density follows demand — only meaningful where demand actually varies.
      const sdTarget = Math.sqrt(cov.target.reduce((a, b) => a + (b - meanTarget) ** 2, 0) / cov.target.length);
      if (sdTarget / meanTarget > 0.3) expect(cov.correlation).toBeGreaterThan(0.6);
      // Bounding box spans (almost) the whole image.
      expect(metrics.boundingBox.maxX - metrics.boundingBox.minX).toBeGreaterThan(image.width * 0.9);
      expect(metrics.boundingBox.maxY - metrics.boundingBox.minY).toBeGreaterThan(image.height * 0.9);
      // No jumps: longest segment stays small relative to the canvas.
      expect(metrics.maxSegmentLength).toBeLessThan(Math.hypot(image.width, image.height) * 0.15);
    });
  }
});

describe('One-Line engine properties', () => {
  it('is deterministic: same image + analysis + settings ⇒ identical path', () => {
    const image = MOTIFS.portrait();
    const a = run(image).path;
    const b = run(image).path;
    expect(hashBytes(new Uint8Array(a.coords.buffer))).toBe(hashBytes(new Uint8Array(b.coords.buffer)));
    expect(a.coords).toEqual(b.coords);
  });

  it('a different seed gives a different but equally valid line', () => {
    const image = MOTIFS.portrait();
    const a = run(image, {}, { seed: 1 }).path;
    const b = run(image, {}, { seed: 2 }).path;
    expect(a.coords).not.toEqual(b.coords);
    expectOneValidLine(b);
  });

  it('has a defined start and end; start lies in the most relevant region', () => {
    const image = objectOnPlain();
    const { path } = run(image);
    const s = startPoint(path);
    const e = endPoint(path);
    expect(Number.isFinite(s.x) && Number.isFinite(e.x)).toBe(true);
    // The dark disc (the object) is the relevant region.
    expect(Math.hypot(s.x - image.width * 0.55, s.y - image.height * 0.5)).toBeLessThan(image.height * 0.3);
  });

  it('can be rendered and animated from the same points', () => {
    const { path } = run(MOTIFS.landscape());
    const svg = renderSvg(path, DEFAULT_RENDER_STYLE);
    expect(svg.data.match(/<path /g)).toHaveLength(1);
    const timeline = createTimeline(path, { durationMs: 2000, fps: 30, pacing: 'constant-speed' });
    expect(toSvgPathData(path, timeline.cursorAtFrame(timeline.frameCount - 1))).toBe(toSvgPathData(path));
    expect(timeline.cursorAtFrame(0).index).toBe(1);
  });

  it('responds to the importance map: more demand ⇒ more line presence', () => {
    // Left half dark and structured, right half light and flat.
    const image = raster(320, 200, (x, y) => (x < 160 ? ((x >> 2) + (y >> 2)) % 2 ? 30 : 110 : 235));
    const { path } = run(image);
    const left = lengthDensity(path, 0, 0, 160, 200);
    const right = lengthDensity(path, 160, 0, 320, 200);
    expect(left).toBeGreaterThan(right * 2);
  });

  it('uses the given analysis: a different importance map changes the path', () => {
    const image = MOTIFS.portrait();
    const real = run(image).path;
    const flat = generateOneLine(
      { image, analysis: uniformAnalyzer.analyze(image, createRandom(1)), settings: DEFAULT_ONE_LINE_SETTINGS },
      TEST_PARAMETERS,
      { rng: createRandom(1) },
    ).path;
    expect(real.coords).not.toEqual(flat.coords);
  });

  it('a homogeneous image gives an even, calm line (no chaos, no hot spots)', () => {
    const image = nearlyUniform();
    const { path, demand } = run(image);
    const metrics = computePathMetrics(path, { demand, coverageCells: 12 });
    const cells = metrics.coverage!.deposited;
    const mean = cells.reduce((a, b) => a + b, 0) / cells.length;
    const sd = Math.sqrt(cells.reduce((a, b) => a + (b - mean) ** 2, 0) / cells.length);
    expect(sd / mean).toBeLessThan(0.35); // even spread
    expect(metrics.maxSegmentLength).toBeLessThan(Math.hypot(image.width, image.height) * 0.1);
    expect(metrics.selfIntersections!).toBeLessThan(pointCount(path) * 0.01);
  });

  it('a single strong contour does NOT produce a contour drawing', () => {
    const image = strongRectangle(400, 300);
    const { path, demand } = run(image);
    expectOneValidLine(path);
    // Length within ±12 px of the rectangle border vs. elsewhere.
    const c = path.coords;
    const [x0, x1, y0, y1] = [100, 300, 75, 225];
    let near = 0, total = 0;
    for (let i = 2; i < c.length; i += 2) {
      const mx = (c[i]! + c[i - 2]!) / 2, my = (c[i + 1]! + c[i - 1]!) / 2;
      const len = Math.hypot(c[i]! - c[i - 2]!, c[i + 1]! - c[i - 1]!);
      total += len;
      const dx = Math.min(Math.abs(mx - x0), Math.abs(mx - x1));
      const dy = Math.min(Math.abs(my - y0), Math.abs(my - y1));
      const onVertical = dx < 12 && my > y0 - 12 && my < y1 + 12;
      const onHorizontal = dy < 12 && mx > x0 - 12 && mx < x1 + 12;
      if (onVertical || onHorizontal) near += len;
    }
    expect(near / total).toBeLessThan(0.5); // the contour is emphasized, but the line is not just the contour
    expect(near / total).toBeGreaterThan(0.1); // …and it IS emphasized
    const metrics = computePathMetrics(path, { demand, coverageCells: 16 });
    expect(metrics.coverage!.counts.untouched).toBe(0); // inside and outside are drawn
    expect(lengthDensity(path, 130, 105, 270, 195)).toBeGreaterThan(0); // interior
    expect(lengthDensity(path, 0, 0, 80, 60)).toBeGreaterThan(0); // background corner
  });

  it('avoids unnecessary crossings', () => {
    const { path } = run(MOTIFS.portrait());
    expect(computePathMetrics(path).selfIntersections!).toBeLessThan(pointCount(path) * 0.01);
  });

  it('handles problematic inputs without crashing', () => {
    const cases = [
      raster(1, 1, () => 128),
      raster(3, 2, (x) => x * 100),
      raster(600, 12, (x) => (x % 50 < 25 ? 30 : 220)), // extreme panorama
      raster(12, 500, (_, y) => (y % 40 < 20 ? 30 : 220)), // extreme portrait
      raster(200, 150, () => 255), // pure white: no importance at all
      raster(200, 150, () => 0), // pure black
    ];
    for (const image of cases) {
      const { path } = run(image);
      expect(validateOneLinePath(path).errors).toEqual([]);
      expect(pointCount(path)).toBeGreaterThanOrEqual(2);
    }
  });

  it('respects maxPoints', () => {
    const { path } = run(MOTIFS.structured(), {}, { maxPoints: 300 });
    expect(pointCount(path)).toBeLessThanOrEqual(300);
    expectOneValidLine(path);
  });

  it('more detail ⇒ more line', () => {
    const image = MOTIFS.portrait();
    expect(pathLength(run(image, {}, { detail: 1 }).path)).toBeGreaterThan(pathLength(run(image, {}, { detail: 0 }).path) * 1.5);
  });

  it('records provenance incl. the source image', () => {
    const { path } = run(MOTIFS.portrait(), {}, { seed: 7 });
    expect(path.meta).toMatchObject({ generatorId: 'importance-stipple-tour', seed: 7, sourceImageId: 'img-test' });
  });

  it('aborts cleanly via shouldAbort (time limit / cancellation)', () => {
    const image = MOTIFS.portrait();
    const analysis = analyzeImage(image);
    let calls = 0;
    expect(() =>
      generateOneLine({ image, analysis, settings: DEFAULT_ONE_LINE_SETTINGS }, TEST_PARAMETERS, { rng: createRandom(1), shouldAbort: () => ++calls > 2 }),
    ).toThrow(EngineError);
  });

  it('rejects an inconsistent analysis with a controlled error', () => {
    const image = MOTIFS.portrait();
    const analysis = analyzeImage(image);
    const broken = { ...analysis, importance: { width: 3, height: 3, data: new Float32Array(9) } };
    expect(() => generateOneLine({ image, analysis: broken, settings: DEFAULT_ONE_LINE_SETTINGS }, TEST_PARAMETERS, { rng: createRandom(1) })).toThrow(
      expect.objectContaining({ code: 'invalid-analysis' }),
    );
  });

  it('with default parameters on a realistic size: valid and within a time budget', () => {
    const image = MOTIFS.portrait(768, 1024);
    const analysis = analyzeImage(image);
    const started = performance.now();
    const { path } = generateOneLine({ image, analysis, settings: DEFAULT_ONE_LINE_SETTINGS }, DEFAULT_ENGINE_PARAMETERS, { rng: createRandom(1) });
    expect(performance.now() - started).toBeLessThan(20_000);
    expectOneValidLine(path);
  });
});
