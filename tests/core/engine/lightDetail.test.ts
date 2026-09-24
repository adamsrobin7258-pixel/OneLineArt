import { describe, expect, it } from 'vitest';
import { analyzeImage, buildDemandField, createRandom, generateOneLine, resolveOneLineSettings, type RasterImage } from '../../../src/core';
import { raster } from '../../fixtures/rasters';
import type { OneLineEngineParameters } from '../../../src/core';
import { TEST_PARAMETERS, lengthDensity } from './helpers';

/** The same parameters with light-area detail switched off (the pre-13.1 behaviour). */
function withoutLightDetail(p: OneLineEngineParameters): OneLineEngineParameters {
  const rest = { ...p };
  delete rest.lightDetail;
  return rest;
}

/**
 * The problem case of phase 13.1: a bright picture area with faint but real
 * structure (light grey stripes on white) next to a strong dark shape that
 * sets the scale of the importance normalization, and a flat bright area.
 */
function lightScene(w = 360, h = 240): RasterImage {
  // Deterministic "sensor noise" (±3 levels) on the flat paper: must not count as structure.
  const noise = (x: number, y: number) => ((((x * 73856093) ^ (y * 19349663)) >>> 0) % 7) - 3;
  return raster(w, h, (x, y) => {
    if ((x - 60) ** 2 + (y - 120) ** 2 < 45 ** 2) return 20; // strong dark disc (left)
    if (x >= 240 && y >= 40 && y < 200) return Math.floor((x - 240) / 6) % 2 ? 226 : 244; // faint light stripes, ≈ 5 % (right)
    if (x >= 130 && x < 226 && y >= 40 && y < 200) return 244 + noise(x, y); // noisy flat paper (middle)
    return 244;
  });
}

const STRIPES = [252, 50, 348, 190] as const;
const FLAT = [130, 50, 226, 190] as const;

function draw(detailLevel: 'minimal' | 'balanced' | 'detail', withLightDetail = true) {
  const image = lightScene();
  const analysis = analyzeImage(image, undefined, 'img-light');
  const e = resolveOneLineSettings({ detailLevel, seed: 3 }, TEST_PARAMETERS);
  const parameters = withLightDetail ? e.parameters : withoutLightDetail(e.parameters);
  const { path } = generateOneLine({ image, analysis, settings: e.settings }, parameters, { rng: createRandom(3) });
  return { path, analysis, parameters };
}

describe('13.1 light-area detail (highest detail level)', () => {
  it('only the highest preset uses it; minimal and balanced are unchanged', () => {
    expect(resolveOneLineSettings({ detailLevel: 'detail' }).parameters.lightDetail).toBe(0.8);
    expect(resolveOneLineSettings({ detailLevel: 'balanced' }).parameters).not.toHaveProperty('lightDetail');
    expect(resolveOneLineSettings({ detailLevel: 'minimal' }).parameters).not.toHaveProperty('lightDetail');
    // Continuous detail between Balanced and Detail fades it in.
    const between = resolveOneLineSettings({ detail: 0.75 }).parameters.lightDetail!;
    expect(between).toBeGreaterThan(0.3);
    expect(between).toBeLessThan(0.5);
  });

  it('demand: light structure is lifted above the (noisy) flat paper; flat areas and dark areas stay as they were', () => {
    const { analysis, parameters } = draw('detail');
    const off = withoutLightDetail(parameters);
    const on = buildDemandField(analysis, parameters).demand;
    const before = buildDemandField(analysis, off).demand;
    const mean = (f: typeof on, [x0, y0, x1, y1]: readonly [number, number, number, number]) => {
      let s = 0, n = 0;
      for (let y = Math.floor((y0 * f.height) / 240); y < Math.floor((y1 * f.height) / 240); y++) {
        for (let x = Math.floor((x0 * f.width) / 360); x < Math.floor((x1 * f.width) / 360); x++) {
          s += f.data[y * f.width + x]!;
          n++;
        }
      }
      return s / n;
    };
    // Before: the faint stripes were hardly above the flat paper (lost after the gamma).
    expect(mean(before, STRIPES) / mean(before, FLAT)).toBeLessThan(2);
    // After: clearly more demand on the stripes …
    expect(mean(on, STRIPES)).toBeGreaterThan(mean(before, STRIPES) * 3);
    expect(mean(on, STRIPES) / mean(on, FLAT)).toBeGreaterThan(8);
    // … while the flat paper and the dark disc keep their demand (no noise, no global change).
    expect(mean(on, FLAT)).toBeCloseTo(mean(before, FLAT), 6);
    expect(mean(on, [40, 100, 80, 140])).toBeCloseTo(mean(before, [40, 100, 80, 140]), 6);
  });

  it('path: the light stripes get clearly more line at the highest level — and do not vanish', () => {
    const on = draw('detail').path;
    const off = draw('detail', false).path;
    const stripesOn = lengthDensity(on, ...STRIPES);
    const stripesOff = lengthDensity(off, ...STRIPES);
    const flatOn = lengthDensity(on, ...FLAT);
    expect(stripesOn).toBeGreaterThan(stripesOff * 1.5);
    expect(stripesOn).toBeGreaterThan(flatOn * 2);
  });

  it('the detail levels stay clearly distinct on the light scene', () => {
    const total = (level: 'minimal' | 'balanced' | 'detail') => lengthDensity(draw(level).path, 0, 0, 360, 240);
    const [minimal, balanced, detail] = [total('minimal'), total('balanced'), total('detail')];
    expect(minimal).toBeLessThan(balanced * 0.9);
    expect(balanced).toBeLessThan(detail * 0.9);
  });
});
