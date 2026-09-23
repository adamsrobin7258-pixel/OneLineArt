import { describe, expect, it } from 'vitest';
import { createRandom } from '../../src/core';

const take = (seed: number, n = 5) => {
  const r = createRandom(seed);
  return Array.from({ length: n }, () => r.next());
};

describe('seeded random', () => {
  it('is reproducible for the same seed', () => {
    expect(take(42)).toEqual(take(42));
  });

  it('differs for different seeds', () => {
    expect(take(42)).not.toEqual(take(43));
  });

  it('stays in [0, 1)', () => {
    for (const v of take(7, 10_000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('forks independent streams by label, regardless of fork order', () => {
    const a = createRandom(1);
    const b = createRandom(1);
    const a1 = a.fork('x').next();
    b.fork('y');
    expect(b.fork('x').next()).toBe(a1);
    expect(createRandom(1).fork('y').next()).not.toBe(a1);
  });
});
