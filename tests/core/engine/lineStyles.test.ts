import { describe, expect, it } from 'vitest';
import {
  GEOMETRIC_ENGINE_ID,
  ONE_LINE_ENGINES,
  ONE_LINE_ENGINE_ID,
  analyzeImage,
  computePathMetrics,
  createRandom,
  generateOneLine,
  hashBytes,
  mergeStraightRuns,
  octilinearRoute,
  oneLineEngine,
  resolveOneLineSettings,
  toSvgPathData,
  validateOneLinePath,
  type OneLinePath,
  type RasterImage,
} from '../../../src/core';
import { MOTIFS, architecture, portrait } from '../../fixtures/scenes';
import { TEST_PARAMETERS } from './helpers';

const hashOf = (p: OneLinePath) => hashBytes(new Uint8Array(p.coords.buffer, p.coords.byteOffset, p.coords.byteLength));

function runStyle(style: 'organic' | 'geometric', image: RasterImage, seed = 3, detailLevel: 'minimal' | 'balanced' | 'detail' = 'balanced') {
  const analysis = analyzeImage(image, undefined, 'img-style');
  const effective = resolveOneLineSettings({ style, seed, detailLevel }, TEST_PARAMETERS);
  return oneLineEngine(effective.engineId).run({ image, analysis, settings: effective.settings }, effective.parameters, { rng: createRandom(seed) });
}

/** Direction of every non-zero segment, in degrees 0..360. */
function segmentAngles(path: OneLinePath): number[] {
  const c = path.coords;
  const out: number[] = [];
  for (let i = 2; i < c.length; i += 2) {
    const dx = c[i]! - c[i - 2]!, dy = c[i + 1]! - c[i - 1]!;
    if (Math.hypot(dx, dy) < 1e-3) continue;
    out.push(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360);
  }
  return out;
}

function expectOneLine(path: OneLinePath) {
  expect(validateOneLinePath(path, { maxSegmentLength: Math.hypot(path.bounds.width, path.bounds.height) * 0.2 }).errors).toEqual([]);
  expect(toSvgPathData(path).match(/M/g)).toHaveLength(1);
}

describe('octilinear routing (geometric line shape)', () => {
  it('turns every segment into at most two legs at multiples of 45°, keeping the vertices', () => {
    const input = new Float64Array([0, 0, 10, 3, 4, 9, 4, 20, -5, 11]);
    const out = octilinearRoute(input);
    for (let i = 0; i < input.length; i += 2) {
      // Every original vertex is still on the line, in order.
      let found = false;
      for (let j = 0; j < out.length; j += 2) if (out[j] === input[i] && out[j + 1] === input[i + 1]) found = true;
      expect(found).toBe(true);
    }
    expect(out.length / 2).toBeLessThanOrEqual(2 * (input.length / 2) - 1);
    for (let i = 2; i < out.length; i += 2) {
      const dx = Math.abs(out[i]! - out[i - 2]!), dy = Math.abs(out[i + 1]! - out[i - 1]!);
      expect(dx < 1e-9 || dy < 1e-9 || Math.abs(dx - dy) < 1e-9).toBe(true);
    }
  });

  it('corners stay inside the segment box (never leave the canvas)', () => {
    const input = new Float64Array([1, 1, 99, 40, 50, 99, 0, 0]);
    const out = octilinearRoute(input);
    for (let i = 0; i < out.length; i += 2) {
      expect(out[i]!).toBeGreaterThanOrEqual(0);
      expect(out[i]!).toBeLessThanOrEqual(99);
      expect(out[i + 1]!).toBeGreaterThanOrEqual(0);
      expect(out[i + 1]!).toBeLessThanOrEqual(99);
    }
  });

  it('merges points in the middle of straight runs', () => {
    expect([...mergeStraightRuns(new Float64Array([0, 0, 1, 0, 2, 0, 2, 1, 2, 5]))]).toEqual([0, 0, 2, 0, 2, 5]);
  });
});

describe('engine registry', () => {
  it('has exactly the organic and the geometric engine; unknown ids are a controlled error', () => {
    expect(Object.keys(ONE_LINE_ENGINES).sort()).toEqual([GEOMETRIC_ENGINE_ID, ONE_LINE_ENGINE_ID].sort());
    expect(() => oneLineEngine('nope')).toThrow(expect.objectContaining({ code: 'invalid-parameters' }));
    expect(() => oneLineEngine('toString')).toThrow(expect.objectContaining({ code: 'invalid-parameters' }));
  });

  it('the organic registry engine is exactly generateOneLine', () => {
    const image = portrait();
    const analysis = analyzeImage(image, undefined, 'img-style');
    const e = resolveOneLineSettings({ seed: 3 }, TEST_PARAMETERS);
    const direct = generateOneLine({ image, analysis, settings: e.settings }, e.parameters, { rng: createRandom(3) }).path;
    const viaRegistry = oneLineEngine(ONE_LINE_ENGINE_ID).run({ image, analysis, settings: e.settings }, e.parameters, { rng: createRandom(3) }).path;
    expect(viaRegistry.coords).toEqual(direct.coords);
    expect(viaRegistry.meta).toEqual(direct.meta);
  });
});

describe('geometric style', () => {
  for (const [name, make] of Object.entries(MOTIFS)) {
    it(`${name}: one valid line made of straight 45°/90° segments that covers the canvas`, () => {
      const image = make();
      const { path, demand } = runStyle('geometric', image);
      expectOneLine(path);
      expect(path.meta.generatorId).toBe(GEOMETRIC_ENGINE_ID);
      // Float32 coordinates: allow a tiny angular error.
      for (const angle of segmentAngles(path)) {
        const off = Math.abs(angle / 45 - Math.round(angle / 45)) * 45;
        expect(off).toBeLessThan(0.5);
      }
      const m = computePathMetrics(path, { demand, coverageCells: 16 });
      expect(m.coverage!.demandCovered).toBeGreaterThan(0.85);
      expect(m.boundingBox.maxX - m.boundingBox.minX).toBeGreaterThan(image.width * 0.9);
      expect(m.boundingBox.maxY - m.boundingBox.minY).toBeGreaterThan(image.height * 0.9);
    });
  }

  it('is deterministic: same image, seed and settings ⇒ identical path; another seed ⇒ another path', () => {
    const image = architecture();
    const a = runStyle('geometric', image).path;
    const b = runStyle('geometric', image).path;
    expect(hashOf(a)).toBe(hashOf(b));
    expect(a.coords).toEqual(b.coords);
    expect(hashOf(runStyle('geometric', image, 4).path)).not.toBe(hashOf(a));
  });

  it('differs visibly from organic but shares the route (same bounds, similar extent)', () => {
    const image = portrait();
    const organic = runStyle('organic', image).path;
    const geometric = runStyle('geometric', image).path;
    expect(hashOf(geometric)).not.toBe(hashOf(organic));
    expect(geometric.bounds).toEqual(organic.bounds);
    // Organic has (almost) no octilinear segments, geometric only.
    const octilinearShare = (p: OneLinePath) => segmentAngles(p).filter((a) => Math.abs(a / 45 - Math.round(a / 45)) * 45 < 0.5).length / segmentAngles(p).length;
    expect(octilinearShare(geometric)).toBe(1);
    expect(octilinearShare(organic)).toBeLessThan(0.3);
  });

  it('detail levels keep their meaning: more detail ⇒ more line', () => {
    const image = portrait();
    const length = (p: OneLinePath) => computePathMetrics(p).length;
    const [minimal, balanced, detail] = (['minimal', 'balanced', 'detail'] as const).map((level) => length(runStyle('geometric', image, 3, level).path));
    expect(minimal).toBeLessThan(balanced!);
    expect(balanced).toBeLessThan(detail!);
  });

  it('both styles return the same OneLinePath format', () => {
    const image = portrait();
    for (const style of ['organic', 'geometric'] as const) {
      const { path } = runStyle(style, image);
      expect(path.coords).toBeInstanceOf(Float32Array);
      expect(Object.keys(path).sort()).toEqual(['bounds', 'coords', 'meta']);
      expect(Object.keys(path.meta).sort()).toEqual(['generatorId', 'generatorVersion', 'seed', 'sourceImageId']);
    }
  });
});
