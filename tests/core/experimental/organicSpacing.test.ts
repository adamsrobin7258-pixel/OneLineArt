import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENGINE_PARAMETERS,
  POINT_BUDGET_LIMIT,
  analyzeImage,
  createRandom,
  generateOneLine,
  hashBytes,
  pathFromCoords,
  pointBudgetFor,
  resolveOneLineSettings,
  type OneLineEngineParameters,
} from '../../../src/core';
import * as core from '../../../src/core';
import {
  RECOMMENDED_SPACING_VARIANT,
  SPACING_VARIANTS,
  factorForTypicalSpacing,
  limitedSpacingFactor,
  measurePassSpacing,
  organicSpacingParameters,
  spacingFactor,
  spacingPatch,
} from '../../../src/core/experimental/organicSpacing';
import { portrait } from '../../fixtures/scenes';
import { TEST_PARAMETERS } from '../engine/helpers';

const hashOf = (a: Float32Array) => hashBytes(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));

function organic(parameters: OneLineEngineParameters, seed = 7) {
  const image = portrait();
  const analysis = analyzeImage(image, undefined, 'img-golden');
  const e = resolveOneLineSettings({ detailLevel: 'balanced', seed }, parameters);
  return { e, analysis, image, run: (p: OneLineEngineParameters) => generateOneLine({ image, analysis, settings: e.settings }, p, { rng: createRandom(e.settings.seed) }) };
}

describe('15.5 organic spacing: parameter patch', () => {
  it('factor 1 is the unchanged production parameter set (same object)', () => {
    const e = resolveOneLineSettings({ detailLevel: 'balanced', seed: 1 });
    const patch = organicSpacingParameters(e.parameters, 1, e.settings.detail);
    expect(patch.parameters).toBe(e.parameters);
    expect(patch.points).toBe(pointBudgetFor(e.parameters, e.settings.detail));
    expect(patch.limited).toBe(false);
  });

  it('a factor scales the point budget by 1/f² and the working-grid cap by 1/f; nothing else changes', () => {
    const base = DEFAULT_ENGINE_PARAMETERS;
    const { parameters: p, points, limited } = organicSpacingParameters(base, 0.7, 0.5);
    expect(p.pointBudget).toEqual({ min: Math.round(4000 / 0.49), max: Math.round(40000 / 0.49) });
    expect(p.maxWorkingEdge).toBe(Math.ceil(1600 / 0.7));
    expect(points).toBe(Math.round(22000 / 0.49));
    expect(limited).toBe(false);
    expect({ ...p, pointBudget: base.pointBudget, maxWorkingEdge: base.maxWorkingEdge }).toEqual(base);
    // The production defaults themselves are untouched.
    expect(DEFAULT_ENGINE_PARAMETERS.pointBudget).toEqual({ min: 4000, max: 40000 });
    expect(DEFAULT_ENGINE_PARAMETERS.maxWorkingEdge).toBe(1600);
  });

  it('beyond the engine safety limit the points are capped and reported', () => {
    const { parameters: p, points, limited } = organicSpacingParameters(DEFAULT_ENGINE_PARAMETERS, 0.4, 1);
    expect(limited).toBe(true);
    expect(points).toBe(POINT_BUDGET_LIMIT.max);
    expect(p.pointBudget).toEqual({ min: POINT_BUDGET_LIMIT.max, max: POINT_BUDGET_LIMIT.max });
    expect(p.maxWorkingEdge).toBeLessThanOrEqual(3072);
    expect(() => organicSpacingParameters(DEFAULT_ENGINE_PARAMETERS, 0, 0.5)).toThrow(RangeError);
    expect(() => organicSpacingParameters(DEFAULT_ENGINE_PARAMETERS, Number.NaN, 0.5)).toThrow(RangeError);
  });

  it('absolute and limited stages resolve to factors in (0, 1]', () => {
    expect(factorForTypicalSpacing(4.8, 3)).toBeCloseTo(0.625, 9);
    expect(factorForTypicalSpacing(2, 3)).toBe(1);
    expect(factorForTypicalSpacing(0, 3)).toBe(1);
    const image = portrait();
    const analysis = analyzeImage(image, undefined, 'x');
    const e = resolveOneLineSettings({ detailLevel: 'balanced', seed: 1 });
    expect(limitedSpacingFactor(analysis, e.parameters, e.settings.detail, 0.6, 0)).toBe(0.6);
    expect(limitedSpacingFactor(analysis, e.parameters, e.settings.detail, 0.6, 1000)).toBe(1);
    const mid = limitedSpacingFactor(analysis, e.parameters, e.settings.detail, 0.6, 1);
    expect(mid).toBeGreaterThanOrEqual(0.6);
    expect(mid).toBeLessThanOrEqual(1);
    const c = { analysis, base: e.parameters, detail: e.settings.detail, baselineMedian: 4 };
    expect(SPACING_VARIANTS[0]!.key).toBe('ref');
    expect(spacingFactor(SPACING_VARIANTS[0]!.spec, c)).toBe(1);
    expect(new Set(SPACING_VARIANTS.map((v) => v.key)).size).toBe(SPACING_VARIANTS.length);
    expect(SPACING_VARIANTS.some((v) => v.key === RECOMMENDED_SPACING_VARIANT)).toBe(true);
    for (const v of SPACING_VARIANTS) {
      const patch = spacingPatch(v.spec, c);
      expect(patch.factor, v.key).toBeGreaterThan(0);
      expect(patch.factor, v.key).toBeLessThanOrEqual(1);
    }
  });
});

describe('15.5 organic spacing: the production engine is only called, never changed', () => {
  it('the baseline stage gives exactly the frozen Organic golden path (portrait / balanced, phase 14.1)', () => {
    const { e, run } = organic(TEST_PARAMETERS);
    const path = run(organicSpacingParameters(e.parameters, 1, e.settings.detail).parameters).path;
    expect({ hash: hashOf(path.coords), points: path.coords.length / 2 }).toEqual({ hash: '9aa56fc9', points: 7702 });
  });

  it('identical input and stage give the identical line; the seed still changes it', () => {
    const { e, run } = organic(TEST_PARAMETERS);
    const p = organicSpacingParameters(e.parameters, 0.7, e.settings.detail).parameters;
    const a = run(p).path, b = run(p).path;
    expect(hashOf(a.coords)).toBe(hashOf(b.coords));
    const other = organic(TEST_PARAMETERS, 8);
    const c = other.run(organicSpacingParameters(other.e.parameters, 0.7, other.e.settings.detail).parameters).path;
    expect(hashOf(c.coords)).not.toBe(hashOf(a.coords));
  });

  it('the experimental module is not exported from the core', () => {
    expect('organicSpacingParameters' in core).toBe(false);
    expect('measurePassSpacing' in core).toBe(false);
  });
});

describe('15.5 organic spacing: the spacing really shrinks with the factor', { timeout: 60000 }, () => {
  it('median pass spacing follows the factor (within 0.1, production budget), the line stays one valid path', () => {
    // The production budget: with the small test budget most samples have no neighbour within the search radius.
    const { e, run, image } = organic(DEFAULT_ENGINE_PARAMETERS);
    const median = (f: number) => {
      const r = run(organicSpacingParameters(e.parameters, f, e.settings.detail).parameters);
      expect(core.validateOneLinePath(r.path).valid).toBe(true);
      const s = measurePassSpacing(r.path);
      expect(s.openShare).toBeLessThan(0.05);
      return s.all.median;
    };
    const base = median(1);
    let previous = base;
    for (const f of [0.8, 0.6]) {
      const m = median(f);
      expect(Math.abs(m / base - f), `factor ${f}`).toBeLessThan(0.1);
      expect(m).toBeLessThan(previous);
      previous = m;
    }
    expect(image.width).toBeGreaterThan(0);
  });
});

describe('15.5 pass spacing metric', () => {
  const lines = (spacing: number, rows: number, length = 400) => {
    const c: number[] = [];
    for (let r = 0; r < rows; r++) {
      const y = 10 + r * spacing;
      if (r % 2 === 0) c.push(10, y, 10 + length, y);
      else c.push(10 + length, y, 10, y);
    }
    return pathFromCoords(Float32Array.from(c), { width: 800, height: 800 }, { generatorId: 'test', generatorVersion: '0', seed: 0 });
  };

  it('parallel passes at a known distance are measured exactly (turns excluded)', () => {
    const s = measurePassSpacing(lines(5, 20));
    expect(s.all.median).toBeCloseTo(5, 6);
    expect(s.all.p10).toBeCloseTo(5, 6);
    expect(s.touchingShare).toBe(0);
    expect(s.denseShare).toBe(0);
    expect(s.length).toBeGreaterThan(20 * 400);
  });

  it('passes closer than the line width count as touching, closer than two widths as dense', () => {
    const touching = measurePassSpacing(lines(0.6, 20), { lineWidth: 0.8 });
    expect(touching.touchingShare).toBeGreaterThan(0.8);
    const dense = measurePassSpacing(lines(1.2, 20), { lineWidth: 0.8 });
    expect(dense.touchingShare).toBe(0);
    expect(dense.denseShare).toBeGreaterThan(0.8);
  });

  it('scales to 800 px on the long edge and splits by the lightness of the original', () => {
    const c = Float32Array.from([10, 10, 410, 10, 410, 20, 10, 20]);
    const s = measurePassSpacing(pathFromCoords(c, { width: 1600, height: 800 }, { generatorId: 't', generatorVersion: '0', seed: 0 }), {
      lightness: { width: 2, height: 2, data: Float32Array.from([0.1, 0.9, 0.1, 0.9]) },
    });
    // 10 px at 1600 px = 5 px at 800 px.
    expect(s.all.median).toBeCloseTo(5, 6);
    expect(s.dark!.samples + s.mid!.samples + s.light!.samples).toBe(s.all.samples);
    expect(s.dark!.samples).toBeGreaterThan(0);
  });
});
