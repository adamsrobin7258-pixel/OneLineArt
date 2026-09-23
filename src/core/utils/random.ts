/**
 * Seeded PRNG (mulberry32). All randomness in the core MUST come from here,
 * never from the unseeded global RNG, so results are reproducible.
 */
export interface Random {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number;
  /** Independent child stream, e.g. one per pipeline stage. */
  fork(label: string): Random;
}

export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    fork: (label) => createRandom(hashString(label) ^ state),
  };
}

/** 32-bit FNV-1a over a string. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Incremental 32-bit FNV-1a, so large files can be hashed chunk by chunk. */
export interface ByteHasher {
  update(bytes: ArrayLike<number>): void;
  /** 8-char hex digest. */
  digest(): string;
}

export function createByteHasher(): ByteHasher {
  let h = 0x811c9dc5;
  return {
    update(bytes) {
      for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i] as number;
        h = Math.imul(h, 0x01000193);
      }
    },
    digest: () => (h >>> 0).toString(16).padStart(8, '0'),
  };
}

/** 32-bit FNV-1a over bytes, as 8-char hex. */
export function hashBytes(bytes: ArrayLike<number>): string {
  const hasher = createByteHasher();
  hasher.update(bytes);
  return hasher.digest();
}
