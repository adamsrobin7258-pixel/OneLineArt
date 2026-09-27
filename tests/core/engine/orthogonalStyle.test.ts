import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENGINE_PARAMETERS,
  ORTHOGONAL_AUTO_START,
  ORTHOGONAL_ENGINE_ID,
  ORTHOGONAL_LINE_PARAMETERS,
  ORTHOGONAL_MAZE_PARAMETERS,
  analyzeImage,
  createRandom,
  hashBytes,
  oneLineEngine,
  resolveOneLineSettings,
  validateOneLinePath,
  type OneLinePath,
  type RasterImage,
} from '../../../src/core';
import { generateVariableWidthLine, measureLineGeometry, type VariableWidthLine } from '../../../src/core/experimental/variableWidth';
import { raster, solid } from '../../fixtures/rasters';
import { MOTIFS } from '../../fixtures/scenes';

/**
 * Phase 16: the production Orthogonal style is the "Free Orthogonal – grown"
 * line of phase 15.4 with its tested reference parameters (3 px spacing on an
 * 800 px working grid, widths 0.338…2.475, safe mode).
 */
const hashOf = (a: Float32Array) => hashBytes(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));

function orthogonal(image: RasterImage, drawing: Parameters<typeof resolveOneLineSettings>[0] = {}) {
  const analysis = analyzeImage(image, undefined, 'img-ortho');
  const e = resolveOneLineSettings({ style: 'orthogonal', ...drawing });
  return oneLineEngine(e.engineId).run({ image, analysis, settings: e.settings }, e.parameters, { rng: createRandom(e.settings.seed) });
}

/** Seeded ±amplitude noise. */
function noisy(w: number, h: number, level: number, amplitude: number, seed = 9): RasterImage {
  let state = seed;
  const next = () => (state = (state * 1103515245 + 12345) >>> 0) / 2 ** 32;
  return raster(w, h, () => Math.round(level + (next() - 0.5) * 2 * amplitude));
}

/** Corner points, directions and segment lengths of an axis-parallel polyline (the centre line itself). */
function corners(c: ArrayLike<number>): { points: number[]; directions: string[]; lengths: number[] } {
  const points = [c[0]!, c[1]!];
  const directions: string[] = [];
  const lengths: number[] = [];
  let dir = '';
  let len = 0;
  for (let i = 2; i < c.length; i += 2) {
    const dx = c[i]! - c[i - 2]!, dy = c[i + 1]! - c[i - 1]!;
    if (dx === 0 && dy === 0) continue;
    const d = dx > 0 ? 'R' : dx < 0 ? 'L' : dy > 0 ? 'D' : 'U';
    if (d !== dir && dir !== '') {
      points.push(c[i - 2]!, c[i - 1]!);
      directions.push(dir);
      lengths.push(len);
      len = 0;
    }
    dir = d;
    len += Math.abs(dx) + Math.abs(dy);
  }
  points.push(c[c.length - 2]!, c[c.length - 1]!);
  directions.push(dir);
  lengths.push(len);
  return { points, directions, lengths };
}
const opposite: Record<string, string> = { R: 'L', L: 'R', U: 'D', D: 'U' };

/** The production path as a VariableWidthLine, for the spacing measurement of the prototype. */
function asLine(path: OneLinePath, working: { width: number; height: number }): VariableWidthLine {
  const k = path.bounds.width / working.width;
  const p = ORTHOGONAL_LINE_PARAMETERS;
  return {
    path,
    widths: path.widths!,
    spacing: p.spacing * k,
    minWidth: p.minWidth * k,
    maxWidth: p.maxWidth * k,
    parameters: { spacing: p.spacing, minWidth: p.minWidth, maxWidth: p.maxWidth } as VariableWidthLine['parameters'],
    issues: [],
    working,
    diagnostics: {} as VariableWidthLine['diagnostics'],
  };
}

describe('16 Orthogonal = the tested phase-15.4 line', () => {
  it('uses exactly the tested reference parameters', () => {
    expect(ORTHOGONAL_LINE_PARAMETERS).toEqual({ workingLongEdge: 800, spacing: 3, minWidth: 0.338, maxWidth: 2.475, contrast: 0, detail: 0.6, smoothing: 0.35, curve: 'perceptual', autoLevels: true });
    expect(ORTHOGONAL_MAZE_PARAMETERS).toEqual({ run: 0.9, straight: 0.2, stairs: 1, hairpins: 0.7, variation: 0, scale: 0.6 });
    expect(ORTHOGONAL_AUTO_START).toEqual({ x: 0, y: 0 });
    // Safe mode: the thickest line leaves a gap (≤ 0.9 × spacing).
    expect(ORTHOGONAL_LINE_PARAMETERS.maxWidth).toBeLessThanOrEqual(0.9 * ORTHOGONAL_LINE_PARAMETERS.spacing);
  });

  it('is bit for bit the prototype line (centre line and widths) for auto start, fixed starts and seeds', () => {
    for (const [start, seed] of [
      [null, 1],
      [{ x: 0.5, y: 0.5 }, 3],
      [{ x: 1, y: 1 }, 7],
    ] as const) {
      const image = MOTIFS.portrait();
      const prod = orthogonal(image, { seed, ...(start ? { startPoint: { mode: 'fixed' as const, ...start } } : {}) }).path;
      const ref = generateVariableWidthLine(image, { route: 'free-orthogonal-grown', spacing: 3, minWidth: 0.338, maxWidth: 2.475, widthMode: 'safe', mazeSeed: seed, start: start ?? { x: 0, y: 0 } });
      expect(hashOf(prod.coords)).toBe(hashOf(ref.path.coords));
      expect(hashOf(prod.widths!)).toBe(hashOf(ref.widths));
    }
  });
});

describe('16 Orthogonal: one line, only horizontal/vertical, only 90° turns, no crossing, full coverage', () => {
  for (const [name, make] of [
    ['portrait', MOTIFS.portrait],
    ['landscape', MOTIFS.landscape],
    ['architecture', MOTIFS.architecture],
  ] as const) {
    it(`${name}: valid single line, axis-parallel segments, 90° turns, no reversal`, () => {
      const { path, diagnostics } = orthogonal(make(), { startPoint: { mode: 'fixed', x: 0.3, y: 0.7 } });
      expect(path.meta.generatorId).toBe(ORTHOGONAL_ENGINE_ID);
      expect(validateOneLinePath(path).errors).toEqual([]);
      const c = path.coords;
      for (let i = 2; i < c.length; i += 2) {
        const dx = c[i]! - c[i - 2]!, dy = c[i + 1]! - c[i - 1]!;
        expect(dx === 0 || dy === 0, `segment ${i / 2}`).toBe(true);
        expect(dx !== 0 || dy !== 0, `zero segment ${i / 2}`).toBe(true);
      }
      const { directions } = corners(c);
      for (let k = 1; k < directions.length; k++) {
        expect(directions[k]).not.toBe(opposite[directions[k - 1]!]);
        expect(directions[k]).not.toBe(directions[k - 1]);
      }
      // No jump: every segment is a merged straight run of at most 32 working px.
      const k = path.bounds.width / diagnostics.workingSize.width;
      let longest = 0;
      for (let i = 2; i < c.length; i += 2) longest = Math.max(longest, Math.hypot(c[i]! - c[i - 2]!, c[i + 1]! - c[i - 1]!));
      expect(longest).toBeLessThanOrEqual(32 * k * 1.01);
    });
  }

  it('visits every lattice point exactly once (full coverage, no crossing) and ends one spacing next to its start', () => {
    const { path, diagnostics } = orthogonal(MOTIFS.portrait(), { startPoint: { mode: 'fixed', x: 0.5, y: 0.5 } });
    const working = diagnostics.workingSize;
    const k = path.bounds.width / working.width;
    const s = ORTHOGONAL_LINE_PARAMETERS.spacing;
    const cw = Math.floor(working.width / (2 * s)), ch = Math.floor(working.height / (2 * s));
    const marginX = (working.width - 2 * cw * s) / 2, marginY = (working.height - 2 * ch * s) / 2;
    // Corner points (and both ends) lie on the lattice; every lattice point on the way is passed once.
    const { points } = corners(path.coords);
    const cell = (x: number, y: number) => [Math.round(x / k / s - marginX / s - 0.5), Math.round(y / k / s - marginY / s - 0.5)] as const;
    const seen = new Set<string>();
    for (let i = 2; i < points.length; i += 2) {
      const [ax, ay] = cell(points[i - 2]!, points[i - 1]!), [bx, by] = cell(points[i]!, points[i + 1]!);
      const steps = Math.abs(bx - ax) + Math.abs(by - ay);
      for (let t = i === 2 ? 0 : 1; t <= steps; t++) {
        const key = `${ax + Math.sign(bx - ax) * t},${ay + Math.sign(by - ay) * t}`;
        expect(seen.has(key), `lattice point ${key} visited twice`).toBe(false);
        seen.add(key);
      }
    }
    expect(seen.size).toBe(4 * cw * ch);
    expect(diagnostics.demandPoints).toBe(cw * ch);
    const c = path.coords, n = c.length;
    expect(Math.hypot(c[n - 2]! - c[0]!, c[n - 1]! - c[1]!) / k).toBeCloseTo(s, 3);
  });

  it('constant spacing: every neighbouring pass is exactly 3 working px away', () => {
    const { path, diagnostics } = orthogonal(solid(300, 220, 128));
    const g = measureLineGeometry(asLine(path, diagnostics.workingSize));
    // ±0.005 working px: float32 rounding of the stored image coordinates (the lattice itself is exact).
    expect(g.spacing.p05).toBeCloseTo(3, 2);
    expect(g.spacing.p95).toBeCloseTo(3, 2);
    expect(g.spacing.min).toBeGreaterThanOrEqual(3 - 5e-3);
    expect(g.overlapShare).toBe(0);
  });

  it('starts at the lattice point nearest to any start point; auto starts at the top-left corner', () => {
    const image = solid(240, 180, 128);
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [0.5, 0.5],
      [0.23, 0.71],
    ] as const) {
      const { path } = orthogonal(image, { startPoint: { mode: 'fixed', x, y } });
      const s = path.bounds.width / 800 * 3 * (800 / 240);
      expect(Math.hypot(path.coords[0]! - x * 240, path.coords[1]! - y * 180), `${x},${y}`).toBeLessThan(s * 1.5);
    }
    expect(hashOf(orthogonal(image).path.coords)).toBe(hashOf(orthogonal(image, { startPoint: { mode: 'fixed', x: 0, y: 0 } }).path.coords));
  });
});

describe('16 Orthogonal: deterministic, image-independent geometry; the image only sets the width', () => {
  it('same image, settings, start and seed ⇒ identical line; seed and start change it; the Organic parameters do not', () => {
    const image = MOTIFS.portrait();
    const base = orthogonal(image, { seed: 4 }).path;
    expect(hashOf(orthogonal(image, { seed: 4 }).path.coords)).toBe(hashOf(base.coords));
    expect(hashOf(orthogonal(image, { seed: 4 }).path.widths!)).toBe(hashOf(base.widths!));
    expect(hashOf(orthogonal(image, { seed: 5 }).path.coords)).not.toBe(hashOf(base.coords));
    expect(hashOf(orthogonal(image, { seed: 4, startPoint: { mode: 'fixed', x: 0.5, y: 0.5 } }).path.coords)).not.toBe(hashOf(base.coords));
    // Detail level and the stipple parameters do not reach the Orthogonal line.
    for (const detailLevel of ['minimal', 'detail'] as const) expect(hashOf(orthogonal(image, { seed: 4, detailLevel }).path.coords)).toBe(hashOf(base.coords));
    const analysis = analyzeImage(image, undefined, 'img-ortho');
    const e = resolveOneLineSettings({ style: 'orthogonal', seed: 4 });
    const other = oneLineEngine(e.engineId).run({ image, analysis, settings: e.settings }, { ...DEFAULT_ENGINE_PARAMETERS, pointBudget: { min: 100, max: 200 } }, { rng: createRandom(99) });
    expect(hashOf(other.path.coords)).toBe(hashOf(base.coords));
  });

  it('black, white, noise, portrait and architecture give the identical centre line; only the widths differ', () => {
    const images = [solid(240, 180, 0), solid(240, 180, 255), noisy(240, 180, 128, 120), MOTIFS.portrait(240, 180), MOTIFS.architecture(240, 180)];
    const runs = images.map((img) => orthogonal(img, { seed: 7, startPoint: { mode: 'fixed', x: 0.6, y: 0.4 } }));
    const ref = corners(runs[0]!.path.coords);
    for (const r of runs.slice(1)) {
      const c = corners(r.path.coords);
      expect(c.points).toEqual(ref.points);
      expect(c.directions).toEqual(ref.directions);
      expect(c.lengths).toEqual(ref.lengths);
      expect(r.diagnostics.rawPoints).toBe(runs[0]!.diagnostics.rawPoints);
    }
    const mean = (w: Float32Array) => w.reduce((a, b) => a + b, 0) / w.length;
    // Dark ⇒ thick, light ⇒ thin, within the tested range (image px = working px here, 240 → 800 × 0.3).
    const k = 240 / 800;
    expect(mean(runs[0]!.path.widths!)).toBeGreaterThan(mean(runs[1]!.path.widths!) * 3);
    for (const r of runs) {
      for (const w of r.path.widths!) {
        expect(w).toBeGreaterThanOrEqual(ORTHOGONAL_LINE_PARAMETERS.minWidth * k - 1e-4);
        expect(w).toBeLessThanOrEqual(ORTHOGONAL_LINE_PARAMETERS.maxWidth * k + 1e-4);
      }
    }
  });

  it('tiny images still give a valid line', () => {
    for (const [w, h] of [
      [2, 2],
      [3, 5],
      [400, 3],
    ] as const) {
      const { path } = orthogonal(raster(w, h, (x, y) => ((x + y) % 2 ? 40 : 210)));
      expect(validateOneLinePath(path).errors, `${w}×${h}`).toEqual([]);
    }
  });
});
