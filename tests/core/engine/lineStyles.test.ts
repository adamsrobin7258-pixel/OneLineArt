import { describe, expect, it } from 'vitest';
import {
  LEGACY_ENGINE_IDS,
  ONE_LINE_ENGINES,
  ONE_LINE_ENGINE_ID,
  ORTHOGONAL_ENGINE_ID,
  analyzeImage,
  createRandom,
  generateOneLine,
  isAvailableEngine,
  oneLineEngine,
  resolveOneLineSettings,
  toSvgPathData,
  validateOneLinePath,
  type OneLinePath,
} from '../../../src/core';
import { portrait } from '../../fixtures/scenes';
import { TEST_PARAMETERS } from './helpers';

function runStyle(style: 'organic' | 'orthogonal', seed = 3) {
  const image = portrait();
  const analysis = analyzeImage(image, undefined, 'img-style');
  const effective = resolveOneLineSettings({ style, seed }, TEST_PARAMETERS);
  return oneLineEngine(effective.engineId).run({ image, analysis, settings: effective.settings }, effective.parameters, { rng: createRandom(seed) });
}

function expectOneLine(path: OneLinePath, maxSegment: number) {
  expect(validateOneLinePath(path, { maxSegmentLength: maxSegment }).errors).toEqual([]);
  expect(toSvgPathData(path).match(/M/g)).toHaveLength(1);
}

describe('engine registry (phase 16)', () => {
  it('has exactly the organic and the orthogonal engine; unknown and removed ids are a controlled error', () => {
    expect(Object.keys(ONE_LINE_ENGINES).sort()).toEqual([ONE_LINE_ENGINE_ID, ORTHOGONAL_ENGINE_ID].sort());
    expect(() => oneLineEngine('nope')).toThrow(expect.objectContaining({ code: 'invalid-parameters' }));
    expect(() => oneLineEngine('toString')).toThrow(expect.objectContaining({ code: 'invalid-parameters' }));
    // Geometric and the old Orthogonal are gone; stored projects that name them keep their stored line.
    for (const id of Object.values(LEGACY_ENGINE_IDS)) {
      expect(isAvailableEngine(id), id).toBe(false);
      expect(() => oneLineEngine(id)).toThrow(expect.objectContaining({ code: 'invalid-parameters' }));
    }
    expect(ORTHOGONAL_ENGINE_ID).not.toBe(LEGACY_ENGINE_IDS.orthogonal);
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

  it('both styles return the same OneLinePath format; only Orthogonal carries a width per point', () => {
    const organic = runStyle('organic').path;
    const orthogonal = runStyle('orthogonal').path;
    for (const path of [organic, orthogonal]) {
      expect(path.coords).toBeInstanceOf(Float32Array);
      expect(Object.keys(path.meta).sort()).toEqual(['generatorId', 'generatorVersion', 'seed', 'sourceImageId']);
      expectOneLine(path, Math.hypot(path.bounds.width, path.bounds.height) * 0.2);
    }
    expect(Object.keys(organic).sort()).toEqual(['bounds', 'coords', 'meta']);
    expect(Object.keys(orthogonal).sort()).toEqual(['bounds', 'coords', 'meta', 'widths']);
    expect(orthogonal.widths).toBeInstanceOf(Float32Array);
    expect(orthogonal.widths!.length).toBe(orthogonal.coords.length / 2);
    expect(orthogonal.meta.generatorId).toBe(ORTHOGONAL_ENGINE_ID);
    expect(organic.meta.generatorId).toBe(ONE_LINE_ENGINE_ID);
  });
});
