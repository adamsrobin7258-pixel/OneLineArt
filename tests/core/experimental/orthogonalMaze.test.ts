import { describe, expect, it } from 'vitest';
import { hashBytes, validateOneLinePath, type RasterImage } from '../../../src/core';
import {
  generateVariableWidthLine,
  measureLineGeometry,
  orthogonalMaze,
  sanitizeVariableWidthParameters,
  variableWidthRoute,
  type VariableWidthLine,
  type VariableWidthParameters,
} from '../../../src/core/experimental/variableWidth';
import { raster, solid } from '../../fixtures/rasters';
import { MOTIFS } from '../../fixtures/scenes';

const MAZE: Partial<VariableWidthParameters> = { route: 'free-orthogonal', workingLongEdge: 240 };
const run = (image: RasterImage, p: Partial<VariableWidthParameters> = {}) => generateVariableWidthLine(image, { ...MAZE, ...p });
const hashOf = (a: Float32Array) => hashBytes(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));

/** Seeded ±amplitude noise. */
function noisy(w: number, h: number, level: number, amplitude: number, seed = 9): RasterImage {
  let state = seed;
  const next = () => (state = (state * 1103515245 + 12345) >>> 0) / 2 ** 32;
  return raster(w, h, () => Math.round(level + (next() - 0.5) * 2 * amplitude));
}

/** The geometric centre line: only the points where the direction changes (plus both ends). */
function corners(c: ArrayLike<number>): { points: number[]; directions: string[]; lengths: number[] } {
  const points = [c[0]!, c[1]!];
  const directions: string[] = [];
  const lengths: number[] = [];
  let dir = '';
  let run = 0;
  for (let i = 2; i < c.length; i += 2) {
    const dx = c[i]! - c[i - 2]!, dy = c[i + 1]! - c[i - 1]!;
    if (dx === 0 && dy === 0) continue;
    const d = dx > 0 ? 'R' : dx < 0 ? 'L' : dy > 0 ? 'D' : 'U';
    if (d !== dir && dir !== '') {
      points.push(c[i - 2]!, c[i - 1]!);
      directions.push(dir);
      lengths.push(run);
      run = 0;
    }
    dir = d;
    run += Math.abs(dx) + Math.abs(dy);
  }
  points.push(c[c.length - 2]!, c[c.length - 1]!);
  directions.push(dir);
  lengths.push(run);
  return { points, directions, lengths };
}

const opposite: Record<string, string> = { R: 'L', L: 'R', U: 'D', D: 'U' };

describe('15.3 free orthogonal: only horizontal and vertical segments, only 90° turns', () => {
  for (const image of [MOTIFS.portrait(), MOTIFS.landscape(), MOTIFS.architecture()]) {
    it(`${image.width}×${image.height}: every segment axis-parallel, every direction change exactly 90°`, () => {
      const line = run(image, { start: { x: 0.3, y: 0.7 } });
      const c = line.path.coords;
      for (let i = 2; i < c.length; i += 2) {
        const dx = c[i]! - c[i - 2]!, dy = c[i + 1]! - c[i - 1]!;
        expect(dx === 0 || dy === 0, `segment ${i / 2}`).toBe(true);
        expect(dx !== 0 || dy !== 0, `zero segment ${i / 2}`).toBe(true);
      }
      const { directions } = corners(c);
      for (let k = 1; k < directions.length; k++) {
        // A change of direction is never a reversal (180°): only 90°.
        expect(directions[k]).not.toBe(opposite[directions[k - 1]!]);
        expect(directions[k]).not.toBe(directions[k - 1]);
      }
      expect(directions.length).toBeGreaterThan(100);
    });
  }
});

describe('15.3 free orthogonal: one line through every cell, no crossing, inside the canvas', () => {
  it('the route visits every lattice point exactly once and ends one spacing next to its start', () => {
    for (const [w, h, s] of [
      [240, 180, 4],
      [180, 240, 6],
      [300, 120, 10],
    ] as const) {
      const r = orthogonalMaze({ width: w, height: h }, { spacing: s, start: { x: 0.5, y: 0.5 }, step: 1 }, { seed: 3, order: 0.8, scale: 0.6 });
      expect(r.maze).not.toBeNull();
      const m = r.maze!;
      // Lattice points = samples on multiples of the spacing from the first cell centre.
      const seen = new Set<string>();
      for (let i = 0; i < r.coords.length; i += 2) {
        const fx = (r.coords[i]! - m.marginX) / s - 0.5, fy = (r.coords[i + 1]! - m.marginY) / s - 0.5;
        if (Math.abs(fx - Math.round(fx)) < 1e-9 && Math.abs(fy - Math.round(fy)) < 1e-9) {
          const key = `${Math.round(fx)},${Math.round(fy)}`;
          expect(seen.has(key), `lattice point ${key} visited twice`).toBe(false);
          seen.add(key);
        }
      }
      expect(seen.size).toBe(m.fineCells);
      // Neighbouring samples are ≤ 1 px apart: no jump anywhere.
      let longest = 0;
      for (let i = 2; i < r.coords.length; i += 2) longest = Math.max(longest, Math.hypot(r.coords[i]! - r.coords[i - 2]!, r.coords[i + 1]! - r.coords[i - 1]!));
      expect(longest).toBeLessThanOrEqual(1 + 1e-9);
      const n = r.coords.length;
      expect(Math.hypot(r.coords[n - 2]! - r.coords[0]!, r.coords[n - 1]! - r.coords[1]!)).toBeCloseTo(s, 9);
      // Inside the canvas with at most one spacing of border on each side.
      expect(m.marginX).toBeGreaterThanOrEqual(0);
      expect(m.marginX).toBeLessThan(s);
      expect(m.marginY).toBeLessThan(s);
      for (let i = 0; i < n; i += 2) {
        expect(r.coords[i]!).toBeGreaterThanOrEqual(m.marginX + s / 2 - 1e-9);
        expect(r.coords[i]!).toBeLessThanOrEqual(w - m.marginX - s / 2 + 1e-9);
        expect(r.coords[i + 1]!).toBeGreaterThanOrEqual(m.marginY + s / 2 - 1e-9);
        expect(r.coords[i + 1]!).toBeLessThanOrEqual(h - m.marginY - s / 2 + 1e-9);
      }
    }
  });

  it('the drawn line is one valid stroke without jumps, NaN or Infinity', () => {
    for (const image of [MOTIFS.portrait(), solid(90, 300, 0), noisy(300, 90, 128, 120)]) {
      const line = run(image);
      const k = line.spacing / line.parameters.spacing;
      expect(validateOneLinePath(line.path, { maxSegmentLength: 32 * k + 1e-3, maxZeroLengthShare: 0, boundsTolerance: 0 }).errors).toEqual([]);
      for (const v of line.path.coords) expect(Number.isFinite(v)).toBe(true);
      for (const v of line.widths) expect(Number.isFinite(v) && v > 0).toBe(true);
    }
  });

  it('tiny canvases fall back to a valid line', () => {
    for (const [w, h] of [[1, 1], [3, 5], [400, 3]] as const) {
      const line = run(raster(w, h, (x, y) => ((x + y) % 2 ? 40 : 210)));
      expect(validateOneLinePath(line.path).errors, `${w}×${h}`).toEqual([]);
    }
  });
});

describe('15.3 free orthogonal: spacing', () => {
  const image = solid(300, 220, 128);
  for (const spacing of [3, 4, 5, 6, 8, 10]) {
    it(`${spacing} px: every neighbouring pass exactly one spacing away (5–95 % and minimum)`, () => {
      const g = measureLineGeometry(run(image, { spacing, maxWidth: 0.8 * spacing, workingLongEdge: 300 }));
      expect(g.spacing.p05).toBeCloseTo(spacing, 6);
      expect(g.spacing.p95).toBeCloseTo(spacing, 6);
      expect(g.spacing.min).toBeGreaterThanOrEqual(spacing - 1e-6);
      expect(g.overlapShare).toBe(0);
      expect(g.unmatched).toBe(0);
    });
  }
});

describe('15.3 free orthogonal: the image never moves the line', () => {
  it('completely different images give the identical centre line (points, directions, segment lengths, start, end); only the widths differ', () => {
    const images = [solid(240, 180, 0), solid(240, 180, 255), noisy(240, 180, 128, 120), MOTIFS.portrait(240, 180)];
    const lines: VariableWidthLine[] = images.map((img) => run(img, { start: { x: 0.6, y: 0.4 }, mazeSeed: 7 }));
    const ref = corners(lines[0]!.path.coords);
    for (const line of lines.slice(1)) {
      const c = corners(line.path.coords);
      expect(c.points.length).toBe(ref.points.length);
      expect(c.points).toEqual(ref.points);
      expect(c.directions).toEqual(ref.directions);
      expect(c.lengths).toEqual(ref.lengths);
    }
    // The widths follow the images.
    const mean = (l: VariableWidthLine) => l.widths.reduce((a, b) => a + b, 0) / l.widths.length;
    expect(mean(lines[0]!)).toBeGreaterThan(mean(lines[1]!) * 3);
    expect(hashOf(lines[2]!.widths)).not.toBe(hashOf(lines[3]!.widths));
    // …and the route itself never sees the image.
    const p = sanitizeVariableWidthParameters({ ...MAZE, start: { x: 0.6, y: 0.4 }, mazeSeed: 7 }).value;
    const a = variableWidthRoute(lines[0]!.working, p), b = variableWidthRoute(lines[3]!.working, p);
    expect(a.coords).toEqual(b.coords);
  });
});

describe('15.3 free orthogonal: parameters and start point', () => {
  const image = solid(240, 180, 128);

  it('identical parameters give the identical line; seed, order, scale and spacing change it reproducibly', () => {
    const base = run(image);
    expect(hashOf(run(image).path.coords)).toBe(hashOf(base.path.coords));
    for (const change of [{ mazeSeed: 2 }, { mazeOrder: 0.2 }, { mazeScale: 1.5 }, { spacing: 6, maxWidth: 5 }] as const) {
      const a = run(image, change), b = run(image, change);
      expect(hashOf(a.path.coords)).toBe(hashOf(b.path.coords));
      expect(hashOf(a.path.coords)).not.toBe(hashOf(base.path.coords));
    }
  });

  it('the line starts at the lattice point nearest to any start point (corners and free points) and ends next to it', () => {
    const starts = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [0.5, 0.5],
      [0.23, 0.71],
    ] as const;
    for (const [x, y] of starts) {
      const line = run(image, { start: { x, y } });
      const { width: W, height: H } = line.path.bounds;
      const s = line.spacing;
      const c = line.path.coords;
      expect(Math.hypot(c[0]! - x * W, c[1]! - y * H), `${x},${y}`).toBeLessThan(s * 1.5);
      expect(Math.hypot(c[c.length - 2]! - c[0]!, c[c.length - 1]! - c[1]!)).toBeCloseTo(s, 4);
      // Deterministic per start point.
      expect(hashOf(run(image, { start: { x, y } }).path.coords)).toBe(hashOf(c));
    }
  });

  it('the start point only opens the same loop elsewhere: the set of lattice segments is identical', () => {
    const segments = (line: VariableWidthLine) => {
      const cs = corners(line.path.coords).points;
      const set = new Set<string>();
      for (let i = 2; i < cs.length; i += 2) {
        const a = `${cs[i - 2]},${cs[i - 1]}`, b = `${cs[i]},${cs[i + 1]}`;
        set.add(a < b ? `${a}|${b}` : `${b}|${a}`);
      }
      return set;
    };
    const a = run(image, { start: { x: 0, y: 0 } }), b = run(image, { start: { x: 0.5, y: 0.5 } });
    // Same loop (same tree); only where it is cut differs, so all but ≤ 3 corner-to-corner segments coincide.
    const sa = segments(a), sb = segments(b);
    let shared = 0;
    for (const e of sa) if (sb.has(e)) shared++;
    expect(shared).toBeGreaterThanOrEqual(sa.size - 3);
    expect(a.diagnostics.length).toBeCloseTo(b.diagnostics.length, 3);
  });
});

describe('15.3 regression: the Phase 15.2 routes are unchanged (bit for bit)', () => {
  // Hashes computed with the Phase 15.2 commit (34c32c0) on the same inputs.
  const reference = [
    ['arc', { workingLongEdge: 300, route: 'arc-spiral', start: { x: 1, y: 0 } }, 'b4218059', '94a5e132'],
    ['organic', { workingLongEdge: 300, route: 'organic-meander' }, '1df1256b', '388487c8'],
    ['flow', { workingLongEdge: 300, route: 'flow', start: { x: 0, y: 1 } }, '1804c31c', 'f3830391'],
    ['controlled', { workingLongEdge: 300, widthMode: 'controlled', maxWidth: 4.6 }, '15198230', 'a2cb90ca'],
  ] as const;
  for (const [name, params, coords, widths] of reference) {
    it(`${name}: identical centre line and widths`, () => {
      const line = generateVariableWidthLine(MOTIFS.portrait(), params as Partial<VariableWidthParameters>);
      expect(hashOf(line.path.coords)).toBe(coords);
      expect(hashOf(line.widths)).toBe(widths);
    });
  }
});
