import { describe, expect, it } from 'vitest';
import { DETAIL_LEVELS, analyzeImage, createRandom, generateOneLine, hashBytes, resolveOneLineSettings } from '../../../src/core';
import { architecture, objectOnPlain, portrait } from '../../fixtures/scenes';
import { TEST_PARAMETERS } from './helpers';

/**
 * Frozen reference of the Organic style (the engine as of phase 11). Style
 * system, continuous detail and new parameters must not change these paths:
 * same image + preset + seed ⇒ bit-identical coordinates and the same key.
 */
const SCENES = { portrait, architecture, objectOnPlain } as const;

const GOLDEN: Record<string, { key: string; hash: string; points: number }> = {
  'portrait/minimal': { key: 'minimal-55eecb82e7ea8e73', hash: '8ee2a4df', points: 3477 },
  'portrait/balanced': { key: 'balanced-32e3985e99490cc7', hash: 'b1962f35', points: 7307 },
  'portrait/detail': { key: 'detail-161e0adfcd4b4ab4', hash: '81d23ab8', points: 13480 },
  'architecture/minimal': { key: 'minimal-55eecb82e7ea8e73', hash: 'cdea4630', points: 4581 },
  'architecture/balanced': { key: 'balanced-32e3985e99490cc7', hash: '1f07ddf1', points: 8213 },
  'architecture/detail': { key: 'detail-161e0adfcd4b4ab4', hash: 'ed9e6fd3', points: 14170 },
  'objectOnPlain/minimal': { key: 'minimal-55eecb82e7ea8e73', hash: 'bf1e1053', points: 3435 },
  'objectOnPlain/balanced': { key: 'balanced-32e3985e99490cc7', hash: 'a4e04c6a', points: 7385 },
  'objectOnPlain/detail': { key: 'detail-161e0adfcd4b4ab4', hash: '6c385e4d', points: 13594 },
};

describe('Organic style golden reference', () => {
  for (const [scene, make] of Object.entries(SCENES)) {
    for (const detailLevel of DETAIL_LEVELS) {
      it(`${scene} / ${detailLevel} is unchanged`, () => {
        const image = make();
        const analysis = analyzeImage(image, undefined, 'img-golden');
        const effective = resolveOneLineSettings({ detailLevel, seed: 7 }, TEST_PARAMETERS);
        const { path } = generateOneLine({ image, analysis, settings: effective.settings }, effective.parameters, { rng: createRandom(effective.settings.seed) });
        const actual = { key: effective.key, hash: hashBytes(new Uint8Array(path.coords.buffer, path.coords.byteOffset, path.coords.byteLength)), points: path.coords.length / 2 };
        const expected = GOLDEN[`${scene}/${detailLevel}`];
        expect(actual).toEqual(expected);
      });
    }
  }
});
