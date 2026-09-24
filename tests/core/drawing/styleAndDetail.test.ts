import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DRAWING_SETTINGS,
  DETAIL_LEVELS,
  DETAIL_PROFILES,
  DRAWING_STYLES,
  DRAWING_STYLE_PROFILES,
  GEOMETRIC_ENGINE_ID,
  ONE_LINE_ENGINE_ID,
  SMOOTHING_RANGE,
  isCustomDrawing,
  pointBudgetFor,
  resolveAllDetailLevels,
  resolveOneLineSettings,
} from '../../../src/core';

const budget = (detail: number) => {
  const e = resolveOneLineSettings({ detail });
  return pointBudgetFor(e.parameters, e.settings.detail);
};

describe('continuous detail', () => {
  it('defaults to the preset (no custom value)', () => {
    expect(DEFAULT_DRAWING_SETTINGS).toMatchObject({ style: 'organic', detail: null, smoothing: null });
    const e = resolveOneLineSettings();
    expect(e.drawing).toMatchObject({ detail: null, smoothing: null });
    expect(isCustomDrawing(e.drawing)).toBe(false);
  });

  it('a slider value on a preset IS that preset: same key, parameters and settings', () => {
    for (const level of DETAIL_LEVELS) {
      const preset = resolveOneLineSettings({ detailLevel: level });
      const viaSlider = resolveOneLineSettings({ detailLevel: 'balanced', detail: DETAIL_PROFILES[level].detail });
      expect(viaSlider.key, level).toBe(preset.key);
      expect(viaSlider.parameters, level).toEqual(preset.parameters);
      expect(viaSlider.drawing, level).toEqual(preset.drawing);
    }
  });

  it('values between presets are custom, interpolate the parameters and grow the budget monotonically', () => {
    const e = resolveOneLineSettings({ detail: 0.35 });
    expect(e.drawing.detail).toBe(0.35);
    expect(e.settings.detail).toBe(0.35);
    expect(isCustomDrawing(e.drawing)).toBe(true);
    expect(e.key.startsWith('custom-')).toBe(true);
    expect(e.issues).toEqual([]);
    const { minimal, balanced } = resolveAllDetailLevels();
    // Halfway between Minimal (0.2) and Balanced (0.5).
    expect(e.parameters.demandGamma).toBeCloseTo((minimal.parameters.demandGamma + balanced.parameters.demandGamma) / 2);
    expect(e.parameters.globalModulation).toBeCloseTo((minimal.parameters.globalModulation + balanced.parameters.globalModulation) / 2);
    expect(Number.isInteger(e.parameters.smoothingIterations)).toBe(true);
    const values = [0, 0.1, 0.2, 0.3, 0.45, 0.5, 0.7, 0.9, 1];
    const budgets = values.map(budget);
    for (let i = 1; i < budgets.length; i++) expect(budgets[i]!, String(values[i])).toBeGreaterThan(budgets[i - 1]!);
  });

  it('every slider position resolves to valid parameters without adjustments', () => {
    for (let d = 0; d <= 1.0001; d += 0.01) expect(resolveOneLineSettings({ detail: Math.round(d * 100) / 100 }).issues).toEqual([]);
  });

  it('invalid values fall back to the preset, out-of-range values are clamped (reported)', () => {
    const nan = resolveOneLineSettings({ detail: Number.NaN });
    expect(nan.drawing.detail).toBeNull();
    expect(nan.issues.map((i) => i.name)).toContain('detail');
    const high = resolveOneLineSettings({ detail: 3 });
    expect(high.settings.detail).toBe(1);
    expect(high.drawing.detailLevel).toBe('detail'); // clamped onto the Detail preset
  });

  it('is deterministic', () => {
    expect(resolveOneLineSettings({ detail: 0.63, seed: 5 })).toEqual(resolveOneLineSettings({ detail: 0.63, seed: 5 }));
  });
});

describe('line smoothing', () => {
  it('extends the existing Chaikin smoothing (smoothingIterations) and makes the drawing custom', () => {
    const base = resolveOneLineSettings();
    const e = resolveOneLineSettings({ smoothing: 4 });
    expect(e.parameters.smoothingIterations).toBe(4);
    expect(e.drawing.smoothing).toBe(4);
    expect(isCustomDrawing(e.drawing)).toBe(true);
    expect(e.key).not.toBe(base.key);
    expect({ ...e.parameters, smoothingIterations: base.parameters.smoothingIterations }).toEqual(base.parameters);
  });

  it("the preset's own value is not custom; values are clamped to the engine range", () => {
    const minimal = resolveOneLineSettings({ detailLevel: 'minimal' });
    expect(resolveOneLineSettings({ detailLevel: 'minimal', smoothing: minimal.parameters.smoothingIterations }).key).toBe(minimal.key);
    expect(resolveOneLineSettings({ smoothing: 99 }).parameters.smoothingIterations).toBe(SMOOTHING_RANGE.max);
    expect(resolveOneLineSettings({ smoothing: 0 }).parameters.smoothingIterations).toBe(0);
  });

  it('does not apply to styles without smoothing (geometric keeps its key)', () => {
    expect(DRAWING_STYLE_PROFILES.geometric.smoothing).toBe(false);
    const plain = resolveOneLineSettings({ style: 'geometric' });
    const smoothed = resolveOneLineSettings({ style: 'geometric', smoothing: 5 });
    expect(smoothed.key).toBe(plain.key);
    expect(smoothed.parameters).toEqual(plain.parameters);
  });
});

describe('drawing styles', () => {
  it('exactly three styles; Organic is the default and uses the original engine', () => {
    expect(DRAWING_STYLES).toEqual(['organic', 'geometric', 'orthogonal']);
    const organic = resolveOneLineSettings();
    expect(organic.drawing.style).toBe('organic');
    expect(organic.engineId).toBe(ONE_LINE_ENGINE_ID);
  });

  it('Geometric uses its own engine and gets its own key (never mixed up in the cache)', () => {
    for (const level of DETAIL_LEVELS) {
      const organic = resolveOneLineSettings({ detailLevel: level });
      const geometric = resolveOneLineSettings({ detailLevel: level, style: 'geometric' });
      expect(geometric.engineId).toBe(GEOMETRIC_ENGINE_ID);
      expect(geometric.key).not.toBe(organic.key);
      // Same detail semantics: presets map to the same parameters in both styles.
      expect(geometric.parameters).toEqual(organic.parameters);
      expect(geometric.settings).toEqual(organic.settings);
    }
  });

  it('an unknown style falls back to Organic (reported)', () => {
    const e = resolveOneLineSettings({ style: 'cubist' as never });
    expect(e.drawing.style).toBe('organic');
    expect(e.issues.map((i) => i.name)).toContain('style');
  });

  it('presets reset custom values but keep the style', () => {
    const all = resolveAllDetailLevels({ style: 'geometric', detail: 0.8, smoothing: 1 });
    for (const level of DETAIL_LEVELS) {
      expect(all[level].drawing).toMatchObject({ style: 'geometric', detailLevel: level, detail: null, smoothing: null });
      expect(isCustomDrawing(all[level].drawing)).toBe(false);
    }
  });

  it('keys of the Organic presets are unchanged by the new settings fields', () => {
    // Same identity as before styles existed (also frozen in organicGolden.test.ts).
    expect(resolveOneLineSettings({ detailLevel: 'balanced', seed: 7 }).key).toBe(resolveOneLineSettings({ detailLevel: 'balanced', seed: 7, style: 'organic', detail: null, smoothing: null }).key);
  });
});
