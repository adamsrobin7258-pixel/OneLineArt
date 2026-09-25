import { describe, expect, it } from 'vitest';
import {
  analyzeImage,
  buildDemandField,
  createRandom,
  hashBytes,
  oneLineEngine,
  resolveOneLineSettings,
  validateOneLinePath,
  DRAWING_STYLES,
  DETAIL_LEVELS,
  type DrawingStyle,
  type OneLineDetailLevel,
  type OneLineEngineParameters,
  type RasterImage,
  type ScalarField,
} from '../../../src/core';
import { raster } from '../../fixtures/rasters';
import { TEST_PARAMETERS, lengthDensity } from './helpers';

/**
 * Phase 14.1 test scene (360×240), four equally sized areas:
 *   left   – dark and FLAT (a night sky / dark wall, ±3 levels sensor noise)
 *   middle – dark and STRUCTURED: fine texture of the same mean tone (like dark fur or an eye, ±22 levels)
 *   right  – top: faint LIGHT stripes (the 13.1 case), bottom: flat light paper with noise
 */
function scene(w = 360, h = 240): RasterImage {
  const noise = (x: number, y: number) => ((((x * 73856093) ^ (y * 19349663)) >>> 0) % 7) - 3;
  return raster(w, h, (x, y) => {
    if (x < 120) return 52 + noise(x, y);
    if (x < 240) return 52 + ((((x >> 1) * 2654435761) ^ ((y >> 1) * 40503)) >>> 0) % 45 - 22; // 2 px speckle, mean 52
    if (y < 120) return Math.floor((x - 240) / 6) % 2 ? 226 : 244;
    return 244 + noise(x, y);
  });
}

type Rect = readonly [number, number, number, number];
// Margins keep the measurement off the borders between the areas.
const DARK_FLAT: Rect = [12, 12, 108, 228];
const DARK_STRUCT: Rect = [132, 12, 228, 228];
const LIGHT_STRUCT: Rect = [252, 12, 348, 108];
const LIGHT_FLAT: Rect = [252, 132, 348, 228];

const IMAGE = scene();
const ANALYSIS = analyzeImage(IMAGE, undefined, 'img-14-1');

function params(level: OneLineDetailLevel, balance?: number): OneLineEngineParameters {
  const p = { ...resolveOneLineSettings({ detailLevel: level, seed: 5 }, TEST_PARAMETERS).parameters };
  if (balance === undefined) delete p.structureToneBalance;
  else p.structureToneBalance = balance;
  return p;
}

function mean(field: ScalarField, [x0, y0, x1, y1]: Rect): number {
  let s = 0, n = 0;
  for (let y = Math.floor((y0 * field.height) / 240); y < Math.floor((y1 * field.height) / 240); y++) {
    for (let x = Math.floor((x0 * field.width) / 360); x < Math.floor((x1 * field.width) / 360); x++) {
      s += field.data[y * field.width + x]!;
      n++;
    }
  }
  return s / n;
}

function draw(style: DrawingStyle, level: OneLineDetailLevel, balance?: number) {
  const e = resolveOneLineSettings({ style, detailLevel: level, seed: 5 }, TEST_PARAMETERS);
  const p = { ...e.parameters };
  if (balance !== undefined) p.structureToneBalance = balance;
  const { path } = oneLineEngine(e.engineId).run({ image: IMAGE, analysis: ANALYSIS, settings: e.settings }, p, { rng: createRandom(e.settings.seed) });
  return path;
}

/** The level's own balance (from the preset). */
const presetBalance = (level: OneLineDetailLevel) => resolveOneLineSettings({ detailLevel: level }).parameters.structureToneBalance;

const hashOf = (coords: Float32Array) => hashBytes(new Uint8Array(coords.buffer, coords.byteOffset, coords.byteLength));

describe('14.1 structure/tone balance', () => {
  it('absent or 0 is exactly the previous demand (bit-identical), with and without lightDetail', () => {
    for (const level of DETAIL_LEVELS) {
      const before = buildDemandField(ANALYSIS, params(level)).demand.data;
      expect(buildDemandField(ANALYSIS, params(level, 0)).demand.data).toEqual(before);
    }
  });

  it('the presets use it subtly on Minimal, clearly on Balanced, most on Detail; the slider interpolates', () => {
    const at = (detailLevel: OneLineDetailLevel) => resolveOneLineSettings({ detailLevel }).parameters.structureToneBalance!;
    expect(at('minimal')).toBe(0.3);
    expect(at('balanced')).toBe(0.6);
    expect(at('detail')).toBe(0.75);
    const between = resolveOneLineSettings({ detail: 0.35 }).parameters.structureToneBalance!;
    expect(between).toBeGreaterThan(0.3);
    expect(between).toBeLessThan(0.6);
  });

  it('demand: a flat dark area no longer competes with dark structure of the same tone; no pixel gains demand', () => {
    for (const level of DETAIL_LEVELS) {
      const before = buildDemandField(ANALYSIS, params(level)).demand;
      const after = buildDemandField(ANALYSIS, params(level, presetBalance(level))).demand;
      const ratioBefore = mean(before, DARK_STRUCT) / mean(before, DARK_FLAT);
      const ratioAfter = mean(after, DARK_STRUCT) / mean(after, DARK_FLAT);
      // Tone still counts: the flat dark area stays clearly above flat light paper.
      expect(mean(after, DARK_FLAT), level).toBeGreaterThan(mean(after, LIGHT_FLAT) * 1.5);
      expect(ratioAfter, level).toBeGreaterThan(ratioBefore * 1.1);
      // The flat dark area is damped; the structured one keeps (at least) its SHARE of the demand —
      // what the line follows, since the point budget is fixed. The factor is ≤ 1 everywhere.
      const all: Rect = [0, 0, 360, 240];
      expect(mean(after, DARK_FLAT), level).toBeLessThan(mean(before, DARK_FLAT) * 0.9);
      expect(mean(after, DARK_STRUCT) / mean(after, all), level).toBeGreaterThanOrEqual(mean(before, DARK_STRUCT) / mean(before, all));
      for (let i = 0; i < after.data.length; i++) expect(after.data[i]!).toBeLessThanOrEqual(before.data[i]! + 1e-7);
    }
  });

  it('the effect grows with the level: subtle on Minimal, stronger on Balanced and Detail', () => {
    const gain = (level: OneLineDetailLevel) => {
      const before = buildDemandField(ANALYSIS, params(level)).demand;
      const after = buildDemandField(ANALYSIS, params(level, presetBalance(level))).demand;
      return mean(after, DARK_STRUCT) / mean(after, DARK_FLAT) / (mean(before, DARK_STRUCT) / mean(before, DARK_FLAT));
    };
    expect(gain('minimal')).toBeLessThan(gain('balanced'));
    expect(gain('balanced')).toBeLessThan(gain('detail'));
  });

  it('every level: light structure keeps its demand advantage over flat light paper (up to a small border effect)', () => {
    for (const level of DETAIL_LEVELS) {
      const before = buildDemandField(ANALYSIS, params(level)).demand;
      const after = buildDemandField(ANALYSIS, params(level, presetBalance(level))).demand;
      // The region blur damps the structured area slightly near its border with flat paper
      // (measured: −1 % Minimal, −2 % Balanced on this 96-px block; Detail gains through lightDetail).
      expect(mean(after, LIGHT_STRUCT) / mean(after, LIGHT_FLAT), level).toBeGreaterThanOrEqual((mean(before, LIGHT_STRUCT) / mean(before, LIGHT_FLAT)) * 0.97);
    }
  });

  it('light areas: 13.1 light structure keeps (at least) its advantage over flat light paper, which stays calm', () => {
    const before = buildDemandField(ANALYSIS, params('detail')).demand;
    const after = buildDemandField(ANALYSIS, params('detail', 0.75)).demand;
    expect(params('detail', 0.75).lightDetail).toBe(0.8);
    expect(mean(after, LIGHT_STRUCT) / mean(after, LIGHT_FLAT)).toBeGreaterThanOrEqual((mean(before, LIGHT_STRUCT) / mean(before, LIGHT_FLAT)) * 0.999);
    expect(mean(after, LIGHT_STRUCT)).toBeCloseTo(mean(before, LIGHT_STRUCT), 3);
    // Flat light paper: the least demanding area, before and after.
    for (const f of [before, after]) {
      expect(mean(f, LIGHT_FLAT)).toBeLessThan(mean(f, DARK_FLAT));
      expect(mean(f, LIGHT_FLAT)).toBeLessThan(mean(f, LIGHT_STRUCT));
    }
  });

  it('path (Balanced, every style): more line on dark structure, less on the flat dark area — which still gets line', () => {
    for (const style of DRAWING_STYLES) {
      const before = draw(style, 'balanced', 0);
      const after = draw(style, 'balanced');
      const ratio = (p: typeof before) => lengthDensity(p, ...DARK_STRUCT) / lengthDensity(p, ...DARK_FLAT);
      expect(ratio(after), style).toBeGreaterThan(ratio(before) * 1.05);
      // Still one-line art, not an edge drawing: the line keeps running through the flat dark area.
      expect(lengthDensity(after, ...DARK_FLAT), style).toBeGreaterThan(lengthDensity(after, ...DARK_STRUCT) * 0.25);
    }
  });

  for (const style of DRAWING_STYLES) {
    for (const level of DETAIL_LEVELS) {
      it(`${style} / ${level}: one valid connected line, deterministic${style === 'orthogonal' ? ', only horizontal and vertical segments' : ''}`, () => {
        const a = draw(style, level);
        const b = draw(style, level);
        expect(hashOf(a.coords)).toBe(hashOf(b.coords));
        const e = resolveOneLineSettings({ style, detailLevel: level }, TEST_PARAMETERS);
        expect(e.parameters.structureToneBalance).toBeGreaterThan(0);
        const report = validateOneLinePath(a);
        expect(report.errors).toEqual([]);
        expect(report.valid).toBe(true);
        // (Jumps: the engine validates its own jump rule and throws otherwise; see also the motif tests.)
        if (style === 'orthogonal') {
          const c = a.coords;
          for (let i = 2; i < c.length; i += 2) expect(c[i] === c[i - 2] || c[i + 1] === c[i - 1]).toBe(true);
        }
      });
    }
  }
});
