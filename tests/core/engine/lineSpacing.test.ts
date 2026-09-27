import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENGINE_PARAMETERS,
  applyLineSpacing,
  analyzeImage,
  buildDemandField,
  createRandom,
  densestPointSpacing,
  generateOneLine,
  hashBytes,
  pointBudgetFor,
  resolveOneLineSettings,
  sanitizeEngineParameters,
  withoutLineSpacing,
} from '../../../src/core';
import { MOTIFS } from '../../fixtures/scenes';

/**
 * Phase 16: the Organic line spacing of phase 15.5 in production (optional
 * engine parameters spacingFactor / spacingFloor, Detail also spacingLead*).
 */
const hashOf = (a: Float32Array) => hashBytes(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));

describe('16 Organic line spacing: exactly the technique tested in phase 15.5', () => {
  // Hashes computed with the phase-15.5 commit (2657ab3): its experimental patch
  // ("−40 %, Boden 1 px" for Minimal/Balanced, "−30 %, Boden 1 px" for Detail) on the
  // production presets of that time, seed 7. The phase-16 presets must give exactly these lines.
  const reference = [
    ['portrait', 'minimal', '1dd2647d', 32716],
    ['portrait', 'balanced', 'c4a4c13d', 69015],
    ['architecture', 'minimal', 'f8df7021', 36500],
    ['architecture', 'balanced', '92bc45dc', 97829],
    ['architecture', 'detail', '0bead117', 178271],
  ] as const;
  for (const [scene, level, hash, points] of reference) {
    it(`${scene} / ${level}: the production preset draws the tested line`, { timeout: 120_000 }, () => {
      const image = MOTIFS[scene]();
      const analysis = analyzeImage(image, undefined, 'img-golden');
      const e = resolveOneLineSettings({ detailLevel: level, seed: 7 });
      const { path } = generateOneLine({ image, analysis, settings: e.settings }, e.parameters, { rng: createRandom(7) });
      expect({ hash: hashOf(path.coords), points: path.coords.length / 2 }).toEqual({ hash, points });
    });
  }

  it('portrait / detail: here the floor would bring Detail down to Balanced — the lead (phase 16) keeps it 20 % ahead', { timeout: 120_000 }, () => {
    // Phase 15.5 on this scene: 'd2809010' / 117 685 points with Detail at factor 0.836 (floor), barely more
    // demand points than Balanced. Phase 16 decided that Detail keeps at least 1.2 × the points of Balanced.
    const image = MOTIFS.portrait();
    const analysis = analyzeImage(image, undefined, 'img-golden');
    const run = (level: 'balanced' | 'detail') => {
      const e = resolveOneLineSettings({ detailLevel: level, seed: 7 });
      return generateOneLine({ image, analysis, settings: e.settings }, e.parameters, { rng: createRandom(7) });
    };
    const balanced = run('balanced'), detail = run('detail');
    expect(hashOf(detail.path.coords)).not.toBe('d2809010');
    expect(detail.diagnostics.demandPoints).toBeGreaterThanOrEqual(balanced.diagnostics.demandPoints * 1.2 * 0.98);
  });
});

describe('16 Organic line spacing: parameters', () => {
  const image = MOTIFS.portrait();
  const analysis = analyzeImage(image, undefined, 'x');

  it('without the spacing parameters nothing changes (every setting made before phase 16 keeps its line)', () => {
    expect(applyLineSpacing(DEFAULT_ENGINE_PARAMETERS, analysis, 0.5)).toBe(DEFAULT_ENGINE_PARAMETERS);
    for (const level of ['minimal', 'balanced', 'detail'] as const) {
      const p = resolveOneLineSettings({ detailLevel: level }).parameters;
      expect(Object.keys(withoutLineSpacing(p)).some((k) => k.startsWith('spacing'))).toBe(false);
    }
  });

  it('factor × budget: 1/f² points, 1/f working-grid cap; the returned parameters carry no spacing keys', () => {
    const p = applyLineSpacing({ ...DEFAULT_ENGINE_PARAMETERS, spacingFactor: 0.6 }, analysis, 0.5);
    expect(p.pointBudget).toEqual({ min: Math.round(4000 / 0.36), max: Math.round(40000 / 0.36) });
    expect(p.maxWorkingEdge).toBe(Math.ceil(1600 / 0.6));
    expect(Object.keys(p).some((k) => k.startsWith('spacing'))).toBe(false);
    expect({ ...p, pointBudget: DEFAULT_ENGINE_PARAMETERS.pointBudget, maxWorkingEdge: DEFAULT_ENGINE_PARAMETERS.maxWorkingEdge }).toEqual(DEFAULT_ENGINE_PARAMETERS);
  });

  it('the floor: the densest area is never closer than the floor (predicted from the demand); never wider than the baseline', () => {
    const base = DEFAULT_ENGINE_PARAMETERS;
    const { demand } = buildDemandField(analysis, base);
    const at = (points: number) => densestPointSpacing(demand, points);
    const budget = pointBudgetFor(base, 0.5);
    for (const floor of [0.5, 1, 2, 50]) {
      const p = applyLineSpacing({ ...base, spacingFactor: 0.6, spacingFloor: floor }, analysis, 0.5);
      const points = pointBudgetFor(p, 0.5);
      expect(points).toBeLessThanOrEqual(Math.round(budget / 0.36) + 1);
      expect(points).toBeGreaterThanOrEqual(budget - 1);
      if (points > budget) expect(at(points)).toBeGreaterThanOrEqual(floor * 0.999);
    }
    // A huge floor keeps the baseline exactly.
    expect(pointBudgetFor(applyLineSpacing({ ...base, spacingFactor: 0.6, spacingFloor: 50 }, analysis, 0.5), 0.5)).toBe(budget);
  });

  it('the lead: a level keeps at least spacingLead × the points of its reference level', () => {
    const base = DEFAULT_ENGINE_PARAMETERS;
    const reference = pointBudgetFor(applyLineSpacing({ ...base, spacingFactor: 0.6, spacingFloor: 1 }, analysis, 0.5), 0.5);
    for (const lead of [1.2, 2, 3]) {
      const p = applyLineSpacing({ ...base, spacingFactor: 0.7, spacingFloor: 1, spacingLead: lead, spacingLeadDetail: 0.5, spacingLeadFactor: 0.6 }, analysis, 1);
      expect(pointBudgetFor(p, 1), `lead ${lead}`).toBeGreaterThanOrEqual(Math.floor(lead * reference * 0.999));
    }
    // Below 1 (interpolated between presets) the lead does nothing.
    const off = applyLineSpacing({ ...base, spacingFactor: 0.7, spacingFloor: 1, spacingLead: 0.6, spacingLeadDetail: 0.5, spacingLeadFactor: 0.3 }, analysis, 1);
    expect(off).toEqual(applyLineSpacing({ ...base, spacingFactor: 0.7, spacingFloor: 1 }, analysis, 1));
  });

  it('the engine limits apply to the new parameters (clamped and reported)', () => {
    const { value, issues } = sanitizeEngineParameters({ ...DEFAULT_ENGINE_PARAMETERS, spacingFactor: 0.1, spacingFloor: 20, spacingLead: 9, spacingLeadDetail: 2, spacingLeadFactor: 3 });
    expect([value.spacingFactor, value.spacingFloor, value.spacingLead, value.spacingLeadDetail, value.spacingLeadFactor]).toEqual([0.3, 10, 4, 1, 1]);
    expect(issues.map((i) => i.name).sort()).toEqual(['spacingFactor', 'spacingFloor', 'spacingLead', 'spacingLeadDetail', 'spacingLeadFactor']);
    expect(() => sanitizeEngineParameters({ ...DEFAULT_ENGINE_PARAMETERS, spacingFactor: Number.NaN })).toThrow();
  });

  it('continuous detail between the presets resolves without adjustments', () => {
    for (const detail of [0.1, 0.3, 0.6, 0.75, 0.9, 0.99]) expect(resolveOneLineSettings({ detail }).issues, `detail ${detail}`).toEqual([]);
  });
});
