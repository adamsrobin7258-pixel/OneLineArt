import { describe, expect, it } from 'vitest';
import {
  analyzeImage,
  buildCornerRoute,
  countSelfIntersections,
  createRandom,
  hashBytes,
  isReversal,
  octilinearChoices,
  octilinearCorner,
  octilinearRoute,
  oneLineEngine,
  orthogonalChoices,
  orthogonalCorner,
  orthogonalRoute,
  removeForcedReversals,
  removeOrthogonalJogs,
  resolveOneLineSettings,
  snapOctilinear,
  uncrossCorners,
  validateOneLinePath,
  type OneLinePath,
} from '../../../src/core';
import { MOTIFS } from '../../fixtures/scenes';
import { TEST_PARAMETERS } from './helpers';

const pathOf = (coords: Float64Array | Float32Array, width = 100, height = 100): OneLinePath => ({
  coords: Float32Array.from(coords),
  bounds: { width, height },
  meta: { generatorId: 'test', generatorVersion: '1', seed: 0 },
});

function reversals(c: ArrayLike<number>): number {
  let n = 0, px = 0, py = 0;
  for (let i = 2; i < c.length; i += 2) {
    const dx = c[i]! - c[i - 2]!, dy = c[i + 1]! - c[i - 1]!;
    if (!dx && !dy) continue;
    if ((px || py) && isReversal(px, py, dx, dy)) n++;
    px = dx;
    py = dy;
  }
  return n;
}

const length = (c: ArrayLike<number>) => {
  let s = 0;
  for (let i = 2; i < c.length; i += 2) s += Math.hypot(c[i]! - c[i - 2]!, c[i + 1]! - c[i - 1]!);
  return s;
};

/** Every point of `points` appears in `route`, in order. */
function visitsInOrder(route: ArrayLike<number>, points: ArrayLike<number>): boolean {
  let j = 0;
  for (let i = 0; i < route.length && j < points.length; i += 2) if (route[i] === points[j] && route[i + 1] === points[j + 1]) j += 2;
  return j === points.length;
}

describe('14.2 Geometric: corner order', () => {
  it('no spike back over the previous leg where the other leg order avoids it (the old greedy order ran straight back)', () => {
    // Up, then a connection whose straight leg points down: straight-first would reverse; diagonal-first does not.
    const points = new Float64Array([0, 2, 0, 0, 1, 3]);
    const route = octilinearRoute(points);
    expect(reversals(route)).toBe(0);
    expect(visitsInOrder(route, points)).toBe(true);
    // Both leg orders have the same length: the route is exactly as long as before.
    expect(length(route)).toBeCloseTo(2 + (2 + Math.SQRT2), 12);
  });

  it('keeps the previous rule elsewhere: straight leg first, diagonal first only where it continues the previous leg', () => {
    expect([...octilinearChoices(new Float64Array([0, 0, 10, 3]))]).toEqual([0]);
    // The diagonal (1,1) continues the previous diagonal leg → diagonal first.
    expect([...octilinearChoices(new Float64Array([0, 0, 2, 2, 12, 5]))]).toEqual([0, 1]);
  });

  it('nearly octilinear segments are moved exactly onto the direction (no leg of a thousandth of a pixel), by at most 0.1 %', () => {
    const points = new Float64Array([0, 0, 100, 0.05, 150, 50.02, 150.001, 80]);
    const snapped = snapOctilinear(points);
    expect([snapped[0], snapped[1]]).toEqual([0, 0]);
    for (let i = 2; i < snapped.length; i += 2) {
      const dx = Math.abs(snapped[i]! - snapped[i - 2]!), dy = Math.abs(snapped[i + 1]! - snapped[i - 1]!);
      expect(dx < 1e-9 || dy < 1e-9 || Math.abs(dx - dy) < 1e-9, `segment ${i / 2}`).toBe(true);
      expect(Math.hypot(snapped[i]! - points[i]!, snapped[i + 1]! - points[i + 1]!)).toBeLessThan(0.001 * 150);
    }
    // After snapping, no connection needs a corner.
    const cornerOf = octilinearCorner(snapped);
    for (let i = 0; i < 3; i++) expect(cornerOf(i, 0)).toBeNull();
  });
});

describe('14.2 Orthogonal: forced spikes and neighbour loops', () => {
  it('a tour zigzag that forces a spike for EVERY corner choice is fixed by swapping two neighbours: same points, no longer drawn line', () => {
    // From the flower photo (Orthogonal Balanced): up, down-and-left, up again.
    const points = new Float64Array([301.32, 188.12, 301.32, 187.3, 299.03, 188.12, 299.03, 187.3, 299.9, 186.13]);
    const before = orthogonalRoute(points);
    expect(reversals(before)).toBeGreaterThan(0);
    const swapped = Float64Array.from(points);
    const choices = orthogonalChoices(swapped);
    expect(removeForcedReversals(swapped, choices)).toBe(1);
    const after = buildCornerRoute(swapped, choices, orthogonalCorner(swapped));
    expect(reversals(after)).toBe(0);
    expect(length(after)).toBeLessThanOrEqual(length(before) + 1e-9);
    // The same points, first and last in place.
    expect([...swapped].sort()).toEqual([...points].sort());
    expect([swapped[0], swapped[1], swapped[8], swapped[9]]).toEqual([points[0], points[1], points[8], points[9]]);
    for (let i = 2; i < after.length; i += 2) expect(after[i] === after[i - 2] || after[i + 1] === after[i - 1]).toBe(true);
  });

  it('two neighbouring connections do not loop over each other when a corner pair avoids it', () => {
    // i: (0,0)→(4,2), i+1: (4,2)→(2,-1). Horizontal-first for both crosses; the crossing-free pair has no reversal either.
    const points = new Float64Array([0, 0, 4, 2, 2, -1]);
    const route = orthogonalRoute(points);
    expect(countSelfIntersections(pathOf(route))).toBe(0);
    expect(reversals(route)).toBe(0);
    expect(visitsInOrder(route, points)).toBe(true);
  });
});

describe('14.2 uncrossCorners (both styles)', () => {
  // Connection 0 (0,0)→(10,4) horizontal-first crosses the later straight connection x = 5 (y −3…3);
  // vertical-first runs above it. Everything else stays as it is.
  const points = new Float64Array([0, 0, 10, 4, 12, -3, 5, -3, 5, 3]);

  it('switches the corner of a connection whose legs cross another part of the line: same points, same length', () => {
    const choices = new Uint8Array([0, 0, 0, 0]);
    const cornerOf = orthogonalCorner(points);
    const before = buildCornerRoute(points, choices, cornerOf);
    expect(countSelfIntersections(pathOf(before))).toBe(1);
    expect(uncrossCorners(points, choices, cornerOf)).toBe(1);
    expect([...choices]).toEqual([1, 0, 0, 0]);
    const after = buildCornerRoute(points, choices, cornerOf);
    expect(countSelfIntersections(pathOf(after))).toBe(0);
    expect(length(after)).toBeCloseTo(length(before), 12);
    expect(reversals(after)).toBeLessThanOrEqual(reversals(before));
  });

  it('never trades a crossing for a spike, and leaves a crossing-free line alone', () => {
    const choices = new Uint8Array([1, 0, 0, 0]);
    expect(uncrossCorners(points, choices, orthogonalCorner(points))).toBe(0);
    expect([...choices]).toEqual([1, 0, 0, 0]);
  });

  it('on real motifs: never more crossings or reversals than the plain corner choice; deterministic', () => {
    for (const make of [MOTIFS.portrait, MOTIFS.structured]) {
      const image = make();
      const analysis = analyzeImage(image, undefined, 'img-14-2');
      const e = resolveOneLineSettings({ style: 'organic', seed: 4 }, TEST_PARAMETERS);
      const tour = oneLineEngine(e.engineId).run({ image, analysis, settings: e.settings }, e.parameters, { rng: createRandom(4) }).path.coords;
      const points = Float64Array.from(tour);
      for (const [choicesOf, cornerOf] of [
        [octilinearChoices, octilinearCorner],
        [orthogonalChoices, orthogonalCorner],
      ] as const) {
        const plain = choicesOf(points);
        const repaired = Uint8Array.from(plain);
        const again = Uint8Array.from(plain);
        uncrossCorners(points, repaired, cornerOf(points));
        uncrossCorners(points, again, cornerOf(points));
        expect(again).toEqual(repaired);
        const a = buildCornerRoute(points, plain, cornerOf(points)), b = buildCornerRoute(points, repaired, cornerOf(points));
        expect(countSelfIntersections(pathOf(b, image.width, image.height))!).toBeLessThanOrEqual(countSelfIntersections(pathOf(a, image.width, image.height))!);
        expect(reversals(b)).toBeLessThanOrEqual(reversals(a));
        expect(length(b)).toBeCloseTo(length(a), 6);
      }
    }
  });
});

describe('14.2 jog removal does not create crossings', () => {
  // A small step down (0.5) between two runs to the right; a vertical segment at x = 15 reaches up to y = 0.25.
  const tail = [20, 5, 30, 5, 30, -2, 15, -2, 15, 0.25, 16, 0.25];
  it('keeps the step when removing it would make the line cross itself', () => {
    const coords = new Float64Array([0, 0, 10, 0, 10, 0.5, 20, 0.5, ...tail]);
    const out = removeOrthogonalJogs(coords, 1);
    expect(countSelfIntersections(pathOf(out))).toBe(0);
    expect(visitsInOrder(out, [10, 0.5])).toBe(true);
  });
  it('still removes it where nothing is crossed', () => {
    const coords = new Float64Array([0, 0, 10, 0, 10, 0.5, 20, 0.5, 20, 5, 30, 5]);
    const out = removeOrthogonalJogs(coords, 1);
    expect(visitsInOrder(out, [10, 0.5])).toBe(false);
    for (let i = 2; i < out.length; i += 2) expect(out[i] === out[i - 2] || out[i + 1] === out[i - 1]).toBe(true);
  });
});

describe('14.2 engine: Geometric and Orthogonal on the motifs', () => {
  for (const style of ['geometric', 'orthogonal'] as const) {
    for (const level of ['minimal', 'balanced', 'detail'] as const) {
      it(`${style} / ${level}: valid connected line, its angles, hardly any spikes, deterministic`, () => {
        const image = MOTIFS.portrait();
        const analysis = analyzeImage(image, undefined, 'img-14-2');
        const e = resolveOneLineSettings({ style, detailLevel: level, seed: 3 }, TEST_PARAMETERS);
        const run = () => oneLineEngine(e.engineId).run({ image, analysis, settings: e.settings }, e.parameters, { rng: createRandom(3) }).path;
        const path = run();
        const c = path.coords;
        expect(hashBytes(new Uint8Array(run().coords.buffer))).toBe(hashBytes(new Uint8Array(c.buffer)));
        expect(validateOneLinePath(path, { maxSegmentLength: 0.2 * Math.hypot(image.width, image.height) }).errors).toEqual([]);
        const segments = (c.length >> 1) - 1;
        for (let i = 2; i < c.length; i += 2) {
          const dx = c[i]! - c[i - 2]!, dy = c[i + 1]! - c[i - 1]!;
          if (style === 'orthogonal') expect(dx === 0 || dy === 0).toBe(true);
          else if (dx || dy) {
            const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
            expect(Math.abs(angle / 45 - Math.round(angle / 45)) * 45).toBeLessThan(0.5);
          }
        }
        // Spikes per segment on this scene before 14.2: Geometric 1.2 / 1.5 / 1.8 %, Orthogonal 0.7 / 0.8 / 3.5 %;
        // now Geometric ≈ 0, Orthogonal ≈ half (0.35 / 0.28 / 2.1 %: the rest are tour zigzags no neighbour swap removes).
        expect(reversals(c) / segments).toBeLessThan(style === 'geometric' ? 0.001 : 0.025);
      });
    }
  }
});
