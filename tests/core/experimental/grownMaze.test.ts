import { describe, expect, it } from 'vitest';
import { hashBytes, validateOneLinePath, type RasterImage } from '../../../src/core';
import {
  DEFAULT_VARIABLE_WIDTH_PARAMETERS,
  buildStages,
  generateVariableWidthLine,
  grownMaze,
  measureLineGeometry,
  sanitizeVariableWidthParameters,
  segmentStats,
  straightSegments,
  variableWidthRoute,
  type VariableWidthLine,
  type VariableWidthParameters,
} from '../../../src/core/experimental/variableWidth';
import { raster, solid } from '../../fixtures/rasters';
import { MOTIFS } from '../../fixtures/scenes';

const GROWN: Partial<VariableWidthParameters> = { route: 'free-orthogonal-grown', workingLongEdge: 240 };
const run = (image: RasterImage, p: Partial<VariableWidthParameters> = {}) => generateVariableWidthLine(image, { ...GROWN, ...p });
const hashOf = (a: Float32Array) => hashBytes(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
const routeOf = (size: { width: number; height: number }, p: Partial<VariableWidthParameters>) => variableWidthRoute(size, sanitizeVariableWidthParameters(p).value);

/** Seeded ±amplitude noise. */
function noisy(w: number, h: number, level: number, amplitude: number, seed = 9): RasterImage {
  let state = seed;
  const next = () => (state = (state * 1103515245 + 12345) >>> 0) / 2 ** 32;
  return raster(w, h, () => Math.round(level + (next() - 0.5) * 2 * amplitude));
}

/** Corner points, directions and segment lengths of an axis-parallel polyline. */
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

describe('15.4 segment statistics', () => {
  it('splits a polyline into straight runs with turn directions', () => {
    // 3 right, 1 down, 2 right, 2 up: turns cw, ccw, ccw.
    const c = [0, 0, 1, 0, 3, 0, 3, 1, 5, 1, 5, -1];
    const { lengths, turns } = straightSegments(c);
    expect([...lengths]).toEqual([3, 1, 2, 2]);
    expect([...turns]).toEqual([1, -1, -1, 0]);
    const st = segmentStats(c, 1);
    expect(st.count).toBe(4);
    expect(st.min).toBe(1);
    expect(st.max).toBe(3);
    expect(st.mean).toBe(2);
    expect(st.atMost1).toBe(0.25);
    expect(st.atMost2).toBe(0.75);
    // The 1-long run lies between opposite turns: a stair step.
    expect(st.stairShare).toBe(0.25);
    expect(st.turnsPer100).toBeCloseTo((3 / 8) * 100, 9);
  });

  it('build stages grow monotonically and end covering the canvas', () => {
    const size = { width: 240, height: 180 };
    const r = routeOf(size, { ...GROWN, start: { x: 0.5, y: 0.5 } });
    const stages = buildStages(r.coords, size, 4, [0.05, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 1]);
    for (let k = 1; k < stages.length; k++) {
      expect(stages[k]!.boxShare).toBeGreaterThanOrEqual(stages[k - 1]!.boxShare);
      expect(stages[k]!.reach).toBeGreaterThanOrEqual(stages[k - 1]!.reach);
    }
    expect(stages.at(-1)!.boxShare).toBeGreaterThan(0.9);
    expect(stages.at(-1)!.spread).toBeLessThan(1.2);
  });
});

describe('15.4 free orthogonal grown: only horizontal and vertical segments, only 90° turns', () => {
  for (const image of [MOTIFS.portrait(), MOTIFS.landscape(), MOTIFS.architecture()]) {
    it(`${image.width}×${image.height}: every segment axis-parallel, every direction change exactly 90°`, () => {
      const c = run(image, { start: { x: 0.3, y: 0.7 } }).path.coords;
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
      expect(directions.length).toBeGreaterThan(100);
    });
  }
});

describe('15.4 free orthogonal grown: one line through every cell, inside the canvas', () => {
  const extremes: Array<Partial<VariableWidthParameters>> = [
    {},
    { mazeRun: 0, mazeStraight: 0, mazeStairs: 0, mazeHairpins: 0 },
    { mazeRun: 1, mazeStraight: 1, mazeStairs: 1, mazeHairpins: 1 },
    { mazeVariation: 1, mazeScale: 0.2 },
  ];
  it('visits every lattice point exactly once, without jumps, and ends one spacing next to its start', () => {
    for (const [w, h, s] of [
      [240, 180, 4],
      [180, 240, 6],
      [300, 120, 10],
      [30, 200, 5],
      // One coarse cell wide: vertical tree edges only.
      [8, 200, 4],
    ] as const) {
      for (const extra of extremes) {
        const p = sanitizeVariableWidthParameters({ ...GROWN, ...extra, spacing: s, start: { x: 0.5, y: 0.5 } }).value;
        const r = grownMaze({ width: w, height: h }, { spacing: s, start: p.start, step: 1 }, { seed: 3, run: p.mazeRun, straight: p.mazeStraight, stairs: p.mazeStairs, hairpins: p.mazeHairpins, variation: p.mazeVariation, scale: p.mazeScale });
        expect(r.maze).not.toBeNull();
        const m = r.maze!;
        const seen = new Set<string>();
        for (let i = 0; i < r.coords.length; i += 2) {
          const fx = (r.coords[i]! - m.marginX) / s - 0.5, fy = (r.coords[i + 1]! - m.marginY) / s - 0.5;
          if (Math.abs(fx - Math.round(fx)) < 1e-9 && Math.abs(fy - Math.round(fy)) < 1e-9) {
            const key = `${Math.round(fx)},${Math.round(fy)}`;
            expect(seen.has(key), `${w}×${h}/${s}: lattice point ${key} visited twice`).toBe(false);
            seen.add(key);
          }
        }
        expect(seen.size).toBe(m.fineCells);
        expect(r.lines).toBe(m.coarseCells);
        let longest = 0;
        for (let i = 2; i < r.coords.length; i += 2) longest = Math.max(longest, Math.hypot(r.coords[i]! - r.coords[i - 2]!, r.coords[i + 1]! - r.coords[i - 1]!));
        expect(longest).toBeLessThanOrEqual(1 + 1e-9);
        const n = r.coords.length;
        expect(Math.hypot(r.coords[n - 2]! - r.coords[0]!, r.coords[n - 1]! - r.coords[1]!)).toBeCloseTo(s, 9);
        for (let i = 0; i < n; i += 2) {
          expect(r.coords[i]!).toBeGreaterThanOrEqual(m.marginX + s / 2 - 1e-9);
          expect(r.coords[i]!).toBeLessThanOrEqual(w - m.marginX - s / 2 + 1e-9);
          expect(r.coords[i + 1]!).toBeGreaterThanOrEqual(m.marginY + s / 2 - 1e-9);
          expect(r.coords[i + 1]!).toBeLessThanOrEqual(h - m.marginY - s / 2 + 1e-9);
        }
      }
    }
  });

  it('the drawn line is one valid stroke; tiny canvases fall back to a valid line', () => {
    for (const image of [MOTIFS.portrait(), solid(90, 300, 0), noisy(300, 90, 128, 120)]) {
      const line = run(image);
      const k = line.spacing / line.parameters.spacing;
      expect(validateOneLinePath(line.path, { maxSegmentLength: 32 * k + 1e-3, maxZeroLengthShare: 0, boundsTolerance: 0 }).errors).toEqual([]);
      for (const v of line.widths) expect(Number.isFinite(v) && v > 0).toBe(true);
    }
    for (const [w, h] of [[1, 1], [3, 5], [400, 3]] as const) {
      expect(validateOneLinePath(run(raster(w, h, (x, y) => ((x + y) % 2 ? 40 : 210))).path).errors, `${w}×${h}`).toEqual([]);
    }
  });
});

describe('15.4 free orthogonal grown: spacing', () => {
  const image = solid(300, 220, 128);
  for (const spacing of [3, 4, 5, 6, 8, 10]) {
    it(`${spacing} px: every neighbouring pass exactly one spacing away`, () => {
      const g = measureLineGeometry(run(image, { spacing, maxWidth: 0.8 * spacing, workingLongEdge: 300 }));
      expect(g.spacing.p05).toBeCloseTo(spacing, 6);
      expect(g.spacing.p95).toBeCloseTo(spacing, 6);
      expect(g.spacing.min).toBeGreaterThanOrEqual(spacing - 1e-6);
      expect(g.overlapShare).toBe(0);
      expect(g.unmatched).toBe(0);
    });
  }
});

describe('15.4 free orthogonal grown: the image never moves the line', () => {
  it('black, white, noise, portrait and architecture give the identical centre line; only the widths differ', () => {
    const images = [solid(240, 180, 0), solid(240, 180, 255), noisy(240, 180, 128, 120), MOTIFS.portrait(240, 180), MOTIFS.architecture(240, 180)];
    const lines: VariableWidthLine[] = images.map((img) => run(img, { start: { x: 0.6, y: 0.4 }, mazeSeed: 7 }));
    const ref = corners(lines[0]!.path.coords);
    for (const line of lines.slice(1)) {
      const c = corners(line.path.coords);
      expect(c.points).toEqual(ref.points);
      expect(c.directions).toEqual(ref.directions);
      expect(c.lengths).toEqual(ref.lengths);
      expect(line.diagnostics.routePoints).toBe(lines[0]!.diagnostics.routePoints);
      expect(line.diagnostics.length).toBeCloseTo(lines[0]!.diagnostics.length, 6);
    }
    const mean = (l: VariableWidthLine) => l.widths.reduce((a, b) => a + b, 0) / l.widths.length;
    expect(mean(lines[0]!)).toBeGreaterThan(mean(lines[1]!) * 3);
    expect(hashOf(lines[2]!.widths)).not.toBe(hashOf(lines[3]!.widths));
  });
});

describe('15.4 free orthogonal grown: determinism, parameters and start point', () => {
  const image = solid(240, 180, 128);

  it('identical seed and parameters give the identical line; every parameter changes it reproducibly', () => {
    const base = run(image);
    expect(hashOf(run(image).path.coords)).toBe(hashOf(base.path.coords));
    for (const change of [{ mazeSeed: 2 }, { mazeRun: 0.4 }, { mazeStraight: 0.8 }, { mazeStairs: 0 }, { mazeHairpins: 0 }, { mazeVariation: 0.6 }, { spacing: 6, maxWidth: 5 }] as const) {
      const a = run(image, change), b = run(image, change);
      expect(hashOf(a.path.coords)).toBe(hashOf(b.path.coords));
      expect(hashOf(a.path.coords), JSON.stringify(change)).not.toBe(hashOf(base.path.coords));
    }
  });

  it('the segment-length distribution is reproducible', () => {
    const size = { width: 300, height: 400 };
    const a = segmentStats(routeOf(size, GROWN).coords, 4), b = segmentStats(routeOf(size, GROWN).coords, 4);
    expect(a).toEqual(b);
    const la = straightSegments(routeOf(size, GROWN).coords).lengths;
    expect(hashBytes(new Uint8Array(la.buffer))).toBe(hashBytes(new Uint8Array(straightSegments(routeOf(size, GROWN).coords).lengths.buffer)));
  });

  it('starts at the lattice point nearest to any start point (corners, centre, free points) and ends next to it; same loop', () => {
    const starts = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [0.5, 0.5],
      [0.23, 0.71],
      [0.87, 0.12],
      [0.41, 0.93],
    ] as const;
    const edges = (line: VariableWidthLine) => {
      const cs = corners(line.path.coords).points;
      const set = new Set<string>();
      for (let i = 2; i < cs.length; i += 2) {
        const a = `${cs[i - 2]},${cs[i - 1]}`, b = `${cs[i]},${cs[i + 1]}`;
        set.add(a < b ? `${a}|${b}` : `${b}|${a}`);
      }
      return set;
    };
    const ref = edges(run(image));
    for (const [x, y] of starts) {
      const line = run(image, { start: { x, y } });
      const { width: W, height: H } = line.path.bounds;
      const s = line.spacing;
      const c = line.path.coords;
      expect(Math.hypot(c[0]! - x * W, c[1]! - y * H), `${x},${y}`).toBeLessThan(s * 1.5);
      expect(Math.hypot(c[c.length - 2]! - c[0]!, c[c.length - 1]! - c[1]!)).toBeCloseTo(s, 4);
      // The labyrinth does not depend on the start: all but ≤ 3 corner-to-corner segments coincide.
      const e = edges(line);
      let shared = 0;
      for (const k of e) if (ref.has(k)) shared++;
      expect(shared).toBeGreaterThanOrEqual(e.size - 3);
    }
  });

  it('new parameters are clamped and reported; defaults are the documented ones', () => {
    const d = DEFAULT_VARIABLE_WIDTH_PARAMETERS;
    expect([d.mazeRun, d.mazeStraight, d.mazeStairs, d.mazeHairpins, d.mazeVariation]).toEqual([0.9, 0.2, 1, 0.7, 0]);
    const { value, issues } = sanitizeVariableWidthParameters({ mazeRun: 2, mazeStairs: -1, mazeVariation: Number.NaN });
    expect(value.mazeRun).toBe(1);
    expect(value.mazeStairs).toBe(0);
    expect(value.mazeVariation).toBe(d.mazeVariation);
    expect(issues.map((i) => i.name)).toEqual(['mazeRun', 'mazeStairs', 'mazeVariation']);
  });
});

describe('15.4 quality target: fewer short segments and stairs than Free Orthogonal 15.3 at order 0', () => {
  it('over five seeds: far fewer segments ≤ 2 spacings and stair steps, longer mean segments', () => {
    const size = { width: 600, height: 800 };
    for (let seed = 1; seed <= 5; seed++) {
      const old = segmentStats(routeOf(size, { route: 'free-orthogonal', mazeOrder: 0, mazeSeed: seed }).coords, 4);
      const grown = segmentStats(routeOf(size, { route: 'free-orthogonal-grown', mazeSeed: seed }).coords, 4);
      expect(old.atMost2).toBeGreaterThan(0.65);
      expect(grown.atMost2).toBeLessThan(0.45);
      expect(grown.atMost1).toBeLessThan(old.atMost1 - 0.08);
      expect(grown.stairShare).toBeLessThan(old.stairShare / 2);
      expect(grown.mean).toBeGreaterThan(old.mean * 1.35);
      expect(grown.min).toBe(1);
    }
  });
});

describe('15.4 regression: Free Orthogonal 15.3 is unchanged (bit for bit)', () => {
  // Hashes computed with the Phase 15.3 commit (6ad99bc) on the same inputs.
  const reference = [
    ['order 0', { workingLongEdge: 300, route: 'free-orthogonal', mazeOrder: 0 }, 'bd1bf676', 'a045de78'],
    ['order 0.1, centre', { workingLongEdge: 300, route: 'free-orthogonal', mazeOrder: 0.1, start: { x: 0.5, y: 0.5 } }, '108f9c46', 'ce1ad0b3'],
    ['default (order 0.8)', { workingLongEdge: 300, route: 'free-orthogonal' }, 'cd6e530c', '75237ccf'],
    ['seed 7, 6 px', { workingLongEdge: 300, route: 'free-orthogonal', mazeSeed: 7, mazeOrder: 0.3, mazeScale: 1.2, spacing: 6, maxWidth: 5, start: { x: 1, y: 0.3 } }, '06e52542', '627fd7d3'],
  ] as const;
  for (const [name, params, coords, widths] of reference) {
    it(`${name}: identical centre line and widths`, () => {
      const line = generateVariableWidthLine(MOTIFS.portrait(), params as Partial<VariableWidthParameters>);
      expect(hashOf(line.path.coords)).toBe(coords);
      expect(hashOf(line.widths)).toBe(widths);
    });
  }
});
