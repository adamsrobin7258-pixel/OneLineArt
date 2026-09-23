import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DRAWING_SETTINGS,
  DEFAULT_ENGINE_PARAMETERS,
  DETAIL_LEVELS,
  DETAIL_PROFILES,
  ENGINE_PARAMETER_LIMITS,
  EngineError,
  POINT_BUDGET_LIMIT,
  pointBudgetFor,
  resolveAllDetailLevels,
  resolveOneLineSettings,
  sanitizeEngineParameters,
  sanitizeOneLineSettings,
  DEFAULT_ONE_LINE_SETTINGS,
} from '../../../src/core';

describe('detail levels and profiles', () => {
  it('there are exactly three levels; Balanced is the default', () => {
    expect(DETAIL_LEVELS).toEqual(['minimal', 'balanced', 'detail']);
    expect(DEFAULT_DRAWING_SETTINGS.detailLevel).toBe('balanced');
    expect(resolveOneLineSettings().drawing.detailLevel).toBe('balanced');
  });

  it('Balanced is exactly the calibrated Part 4 engine default', () => {
    expect(resolveOneLineSettings({ detailLevel: 'balanced' }).parameters).toEqual(DEFAULT_ENGINE_PARAMETERS);
  });

  it('every profile resolves to valid parameters without adjustments', () => {
    for (const level of DETAIL_LEVELS) expect(resolveOneLineSettings({ detailLevel: level }).issues).toEqual([]);
  });

  it('line budget grows Minimal < Balanced < Detail', () => {
    const budgets = DETAIL_LEVELS.map((level) => {
      const e = resolveOneLineSettings({ detailLevel: level });
      return pointBudgetFor(e.parameters, e.settings.detail);
    });
    expect(budgets[0]!).toBeLessThan(budgets[1]!);
    expect(budgets[1]!).toBeLessThan(budgets[2]!);
  });

  it('levels differ in more than the line budget', () => {
    for (const level of ['minimal', 'detail'] as const) {
      const changed = Object.keys(DETAIL_PROFILES[level].parameters).filter((k) => k !== 'pointBudget');
      expect(changed.length, level).toBeGreaterThanOrEqual(5);
    }
    const all = resolveAllDetailLevels();
    // Minimal abstracts (smoothed demand, more global weight); Detail sharpens (more local weight, less simplification).
    expect(all.minimal.parameters.demandSmoothing).toBeGreaterThan(all.balanced.parameters.demandSmoothing);
    expect(all.minimal.parameters.globalModulation).toBeGreaterThan(all.balanced.parameters.globalModulation);
    expect(all.detail.parameters.globalModulation).toBeLessThan(all.balanced.parameters.globalModulation);
    expect(all.minimal.parameters.simplificationTolerance).toBeGreaterThan(all.balanced.parameters.simplificationTolerance);
    expect(all.detail.parameters.simplificationTolerance).toBeLessThan(all.balanced.parameters.simplificationTolerance);
    expect(all.minimal.parameters.curvaturePenalty).toBeGreaterThan(all.detail.parameters.curvaturePenalty);
  });
});

describe('effective settings', () => {
  it('are deterministic and identified by a stable key', () => {
    expect(resolveOneLineSettings({ detailLevel: 'detail', seed: 4 })).toEqual(resolveOneLineSettings({ detailLevel: 'detail', seed: 4 }));
    const keys = new Set([
      resolveOneLineSettings({ detailLevel: 'minimal' }).key,
      resolveOneLineSettings({ detailLevel: 'balanced' }).key,
      resolveOneLineSettings({ detailLevel: 'detail' }).key,
      resolveOneLineSettings({ detailLevel: 'balanced', seed: 2 }).key,
      resolveOneLineSettings({ detailLevel: 'balanced', overrides: { curvaturePenalty: 1 } }).key,
    ]);
    expect(keys.size).toBe(5);
  });

  it('record everything needed to reproduce an artwork', () => {
    const e = resolveOneLineSettings({ detailLevel: 'minimal', seed: 42 });
    expect(e.drawing.detailLevel).toBe('minimal');
    expect(e.settings.seed).toBe(42);
    expect(e.engineId).toBe('importance-stipple-tour');
    expect(e.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(e.parameters.pointBudget).toEqual(DEFAULT_ENGINE_PARAMETERS.pointBudget);
  });

  it('profile ← options ← user overrides (overrides win, nested patches merge)', () => {
    const e = resolveOneLineSettings({ detailLevel: 'minimal', overrides: { curvaturePenalty: 1.2, pointBudget: { max: 50_000 } } });
    expect(e.parameters.curvaturePenalty).toBe(1.2);
    expect(e.parameters.demandSmoothing).toBe(DETAIL_PROFILES.minimal.parameters.demandSmoothing);
    expect(e.parameters.pointBudget).toEqual({ min: DEFAULT_ENGINE_PARAMETERS.pointBudget.min, max: 50_000 });
  });

  it('prepared but unavailable options fall back to their defaults (reported)', () => {
    const e = resolveOneLineSettings({ lineCharacter: 'dynamic', crossingStyle: 'encourage' });
    expect(e.drawing.lineCharacter).toBe('balanced');
    expect(e.drawing.crossingStyle).toBe('minimize');
    expect(e.issues.map((i) => i.name)).toEqual(['lineCharacter', 'crossingStyle']);
  });

  it('unknown detail levels fall back to Balanced', () => {
    expect(resolveOneLineSettings({ detailLevel: 'ultra' as never }).drawing.detailLevel).toBe('balanced');
  });

  it('a fixed start point is carried into the engine settings (normalized, clamped)', () => {
    expect(resolveOneLineSettings({ startPoint: { mode: 'fixed', x: 0.25, y: 1.4 } }).settings.startPoint).toEqual({ x: 0.25, y: 1 });
    expect(resolveOneLineSettings().settings.startPoint).toBeUndefined();
  });

  it('rejects non-finite seeds and parameters with a controlled error', () => {
    expect(() => resolveOneLineSettings({ seed: NaN })).toThrow(EngineError);
    expect(() => resolveOneLineSettings({ overrides: { curvaturePenalty: Infinity } })).toThrow(expect.objectContaining({ code: 'invalid-parameters' }));
  });
});

describe('15. parameter safety limits', () => {
  it('clamp out-of-range values and report them', () => {
    const { value, issues } = sanitizeEngineParameters({ ...DEFAULT_ENGINE_PARAMETERS, pointBudget: { min: -5, max: 10_000_000 }, demandGamma: 99, relaxationIterations: 2.6 });
    expect(value.pointBudget).toEqual({ min: POINT_BUDGET_LIMIT.min, max: POINT_BUDGET_LIMIT.max });
    expect(value.demandGamma).toBe(ENGINE_PARAMETER_LIMITS.demandGamma.max);
    expect(value.relaxationIterations).toBe(3);
    expect(issues.length).toBe(4);
  });

  it('fix impossible combinations', () => {
    const swapped = sanitizeEngineParameters({ ...DEFAULT_ENGINE_PARAMETERS, pointBudget: { min: 9000, max: 1000 } });
    expect(swapped.value.pointBudget).toEqual({ min: 1000, max: 9000 });
    const edges = sanitizeEngineParameters({ ...DEFAULT_ENGINE_PARAMETERS, workingMaxEdge: 1000, maxWorkingEdge: 500 });
    expect(edges.value.maxWorkingEdge).toBe(1000);
  });

  it('reject NaN / Infinity / non-numbers', () => {
    for (const bad of [NaN, Infinity, -Infinity, '3' as unknown as number]) {
      expect(() => sanitizeEngineParameters({ ...DEFAULT_ENGINE_PARAMETERS, toneWeight: bad })).toThrow(EngineError);
    }
    expect(() => sanitizeOneLineSettings({ ...DEFAULT_ONE_LINE_SETTINGS, maxPoints: NaN })).toThrow(EngineError);
  });

  it('the defaults and every profile lie within the limits', () => {
    expect(sanitizeEngineParameters(DEFAULT_ENGINE_PARAMETERS).issues).toEqual([]);
    for (const e of Object.values(resolveAllDetailLevels())) {
      for (const [name, limit] of Object.entries(ENGINE_PARAMETER_LIMITS)) {
        const v = e.parameters[name as keyof typeof ENGINE_PARAMETER_LIMITS];
        expect(v, name).toBeGreaterThanOrEqual(limit.min);
        expect(v, name).toBeLessThanOrEqual(limit.max);
      }
    }
  });
});
