import { describe, expect, it } from 'vitest';
import {
  DETAIL_LEVELS,
  analyzeImage,
  computePathMetrics,
  createRandom,
  generateOneLine,
  measureImportanceRepresentation,
  pathLength,
  pointCount,
  resolveOneLineSettings,
  startPoint,
  toSvgPathData,
  validateOneLinePath,
  type OneLineDetailLevel,
  type RasterImage,
} from '../../../src/core';
import { MOTIFS } from '../../fixtures/scenes';
import { TEST_PARAMETERS } from '../engine/helpers';

/** Runs the engine for a level on a precomputed analysis (like the app: analysis once, engine per level). */
function runLevel(image: RasterImage, analysis: ReturnType<typeof analyzeImage>, level: OneLineDetailLevel, seed = 1) {
  const effective = resolveOneLineSettings({ detailLevel: level, seed }, TEST_PARAMETERS);
  return generateOneLine({ image, analysis, settings: effective.settings }, effective.parameters, { rng: createRandom(effective.settings.seed) });
}

describe('detail levels on real engine runs', () => {
  const image = MOTIFS.portrait(300, 400);
  const analysis = analyzeImage(image, undefined, 'img');
  const results = Object.fromEntries(DETAIL_LEVELS.map((level) => [level, runLevel(image, analysis, level)])) as Record<OneLineDetailLevel, ReturnType<typeof runLevel>>;

  it('1/6/7/8. every level gives one valid, connected, in-bounds line', () => {
    for (const level of DETAIL_LEVELS) {
      const { path } = results[level];
      expect(validateOneLinePath(path).errors, level).toEqual([]);
      expect(toSvgPathData(path).match(/M/g), level).toHaveLength(1);
    }
  });

  it('3/4. Minimal < Balanced < Detail in points and line length', () => {
    const counts = DETAIL_LEVELS.map((l) => pointCount(results[l].path));
    const lengths = DETAIL_LEVELS.map((l) => pathLength(results[l].path));
    expect(counts[0]!).toBeLessThan(counts[1]!);
    expect(counts[1]!).toBeLessThan(counts[2]!);
    expect(lengths[0]!).toBeLessThan(lengths[1]!);
    expect(lengths[1]!).toBeLessThan(lengths[2]!);
  });

  it('5. higher levels represent more of the important structures (not just more points)', () => {
    // Measured against the level-independent ANALYSIS importance on a fine grid.
    const touched = DETAIL_LEVELS.map((l) => measureImportanceRepresentation(results[l].path, analysis.importance, 120).highImportanceTouched);
    expect(touched[0]!).toBeLessThan(touched[1]!);
    expect(touched[1]!).toBeLessThanOrEqual(touched[2]!);
    // Detail puts its extra line where the information is: important cells get denser relative to the rest.
    const ratio = (l: OneLineDetailLevel) => {
      const r = measureImportanceRepresentation(results[l].path, analysis.importance, 60);
      return r.highImportanceDensity / r.otherDensity;
    };
    expect(ratio('detail')).toBeGreaterThan(ratio('balanced'));
  });

  it('Minimal abstracts: its demand smoothing suppresses small structures', () => {
    const roughness = (demand: { width: number; height: number; data: Float32Array }) => {
      let sum = 0;
      for (let y = 0; y < demand.height; y++) for (let x = 1; x < demand.width; x++) sum += Math.abs(demand.data[y * demand.width + x]! - demand.data[y * demand.width + x - 1]!);
      return sum / (demand.width * demand.height);
    };
    // Same Minimal profile, only the smoothing lever switched off.
    const unsmoothed = resolveOneLineSettings({ detailLevel: 'minimal', overrides: { demandSmoothing: 0 } }, TEST_PARAMETERS);
    const plain = generateOneLine({ image, analysis, settings: unsmoothed.settings }, unsmoothed.parameters, { rng: createRandom(1) });
    expect(roughness(results.minimal.demand)).toBeLessThan(roughness(plain.demand) * 0.8);
  });

  it('Detail stays organic: no jumps, few crossings, calm turns', () => {
    const m = computePathMetrics(results.detail.path);
    expect(m.maxSegmentLength).toBeLessThan(Math.hypot(image.width, image.height) * 0.1);
    expect(m.selfIntersections!).toBeLessThan(m.pointCount * 0.01);
  });

  it('9/10. deterministic: same image + level + seed ⇒ same path', () => {
    for (const level of DETAIL_LEVELS) expect(runLevel(image, analysis, level).path.coords, level).toEqual(results[level].path.coords);
  });

  it('11. another seed ⇒ another valid path', () => {
    const other = runLevel(image, analysis, 'balanced', 7).path;
    expect(other.coords).not.toEqual(results.balanced.path.coords);
    expect(validateOneLinePath(other).valid).toBe(true);
  });

  it('13/14. all levels are computed from the same, unchanged analysis', () => {
    const fresh = analyzeImage(image, undefined, 'img');
    for (const name of ['importance', 'luminance', 'globalRelevance'] as const) expect(analysis[name].data).toEqual(fresh[name].data);
  });
});

describe('prepared start point mode', () => {
  it('a fixed start point starts the line there', () => {
    const image = MOTIFS.landscape();
    const analysis = analyzeImage(image);
    const effective = resolveOneLineSettings({ startPoint: { mode: 'fixed', x: 0.9, y: 0.1 } }, TEST_PARAMETERS);
    const { path } = generateOneLine({ image, analysis, settings: effective.settings }, effective.parameters, { rng: createRandom(1) });
    const s = startPoint(path);
    expect(Math.hypot(s.x - image.width * 0.9, s.y - image.height * 0.1)).toBeLessThan(Math.max(image.width, image.height) * 0.08);
  });
});
