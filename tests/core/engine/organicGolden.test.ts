import { describe, expect, it } from 'vitest';
import { DETAIL_LEVELS, analyzeImage, createRandom, generateOneLine, hashBytes, resolveOneLineSettings, type OneLineEngineParameters } from '../../../src/core';
import { architecture, objectOnPlain, portrait } from '../../fixtures/scenes';
import { TEST_PARAMETERS } from './helpers';

/**
 * Frozen reference of the Organic style (the engine as of phase 11). Style
 * system, continuous detail and new parameters must not change these paths:
 * same image + preset + seed ⇒ bit-identical coordinates and the same key.
 *
 * Phase 13.1 deliberately extended the Detail preset (lightDetail). Its
 * phase-12 reference stays frozen below and is still checked: the Detail
 * preset WITHOUT lightDetail must give exactly the old paths (the engine is
 * unchanged); the new Detail preset has its own frozen reference.
 *
 * Phase 14.1 deliberately extended all three presets (structureToneBalance).
 * Their paths are frozen in GOLDEN_14_1; GOLDEN and GOLDEN_13_1 stay frozen
 * and are still checked: the presets WITHOUT structureToneBalance must give
 * exactly the pre-14.1 paths (the engine is unchanged).
 *
 * Phase 16 deliberately extended all three presets (line spacing: spacingFactor,
 * spacingFloor; Detail also spacingLead*, see lineSpacing.ts). Their current
 * paths are frozen in GOLDEN_16, generated once from exactly these production
 * presets. GOLDEN_14_1 is no longer the preset result, but it stays frozen and
 * is still checked: the presets WITHOUT the spacing parameters must give
 * exactly the 14.1 paths — the engine itself is unchanged, so a changed
 * algorithm cannot hide behind the new goldens.
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

/** Detail preset since phase 13.1 (with lightDetail). */
const GOLDEN_13_1: Record<string, { key: string; hash: string; points: number }> = {
  portrait: { key: 'detail-934269ba6a8c3bdb', hash: '727135e1', points: 13416 },
  architecture: { key: 'detail-934269ba6a8c3bdb', hash: 'a47bc31d', points: 14066 },
  objectOnPlain: { key: 'detail-934269ba6a8c3bdb', hash: '8dd42718', points: 13599 },
};

/** All presets since phase 14.1 (with structureToneBalance). */
const GOLDEN_14_1: Record<string, { key: string; hash: string; points: number }> = {
  'portrait/minimal': { key: 'minimal-377d95265fb196df', hash: '0b389943', points: 3904 },
  'portrait/balanced': { key: 'balanced-4e4402e1f7105766', hash: '9aa56fc9', points: 7702 },
  'portrait/detail': { key: 'detail-8605cb05211eccd2', hash: '80aed78c', points: 13178 },
  'architecture/minimal': { key: 'minimal-377d95265fb196df', hash: '04568d80', points: 4813 },
  'architecture/balanced': { key: 'balanced-4e4402e1f7105766', hash: '9990f361', points: 8153 },
  'architecture/detail': { key: 'detail-8605cb05211eccd2', hash: 'e13b0a28', points: 14278 },
  'objectOnPlain/minimal': { key: 'minimal-377d95265fb196df', hash: '84944143', points: 3762 },
  'objectOnPlain/balanced': { key: 'balanced-4e4402e1f7105766', hash: 'e1af700b', points: 7789 },
  'objectOnPlain/detail': { key: 'detail-8605cb05211eccd2', hash: '979d582c', points: 13509 },
};

/** All presets since phase 16 (with the line spacing). */
const GOLDEN_16: Record<string, { key: string; hash: string; points: number }> = {
  'portrait/minimal': { key: 'minimal-696f0fa884d577d1', hash: '62c0472d', points: 7985 },
  'portrait/balanced': { key: 'balanced-277b0c7f82b474d4', hash: 'a99749b8', points: 18033 },
  'portrait/detail': { key: 'detail-00ed3cc55b76de12', hash: '102ba472', points: 25883 },
  'architecture/minimal': { key: 'minimal-696f0fa884d577d1', hash: '9e81287b', points: 9166 },
  'architecture/balanced': { key: 'balanced-277b0c7f82b474d4', hash: '43b13c8f', points: 19261 },
  'architecture/detail': { key: 'detail-00ed3cc55b76de12', hash: '48cdbdd0', points: 27720 },
  'objectOnPlain/minimal': { key: 'minimal-696f0fa884d577d1', hash: 'fea9db00', points: 7982 },
  'objectOnPlain/balanced': { key: 'balanced-277b0c7f82b474d4', hash: '9a1d478c', points: 18359 },
  'objectOnPlain/detail': { key: 'detail-00ed3cc55b76de12', hash: '4a492e85', points: 25843 },
};

/** The preset parameters without the phase-16 line spacing (= the 14.1 presets). */
function withoutSpacing(parameters: OneLineEngineParameters): OneLineEngineParameters {
  const { spacingFactor, spacingFloor, spacingLead, spacingLeadDetail, spacingLeadFactor, ...pre16 } = parameters;
  expect(spacingFactor).toBeGreaterThan(0);
  expect(spacingFloor).toBe(1);
  void [spacingLead, spacingLeadDetail, spacingLeadFactor];
  return pre16;
}

describe('Organic style golden reference', () => {
  for (const [scene, make] of Object.entries(SCENES)) {
    for (const detailLevel of DETAIL_LEVELS) {
      it(`${scene} / ${detailLevel} is unchanged`, () => {
        const image = make();
        const analysis = analyzeImage(image, undefined, 'img-golden');
        const effective = resolveOneLineSettings({ detailLevel, seed: 7 }, TEST_PARAMETERS);
        const { path } = generateOneLine({ image, analysis, settings: effective.settings }, effective.parameters, { rng: createRandom(effective.settings.seed) });
        const actual = { key: effective.key, hash: hashBytes(new Uint8Array(path.coords.buffer, path.coords.byteOffset, path.coords.byteLength)), points: path.coords.length / 2 };
        expect(actual).toEqual(GOLDEN_16[`${scene}/${detailLevel}`]);
      });

      it(`${scene} / ${detailLevel} without the line spacing is still exactly the 14.1 path`, () => {
        const image = make();
        const analysis = analyzeImage(image, undefined, 'img-golden');
        const effective = resolveOneLineSettings({ detailLevel, seed: 7 }, TEST_PARAMETERS);
        const { path } = generateOneLine({ image, analysis, settings: effective.settings }, withoutSpacing(effective.parameters), { rng: createRandom(effective.settings.seed) });
        const old = GOLDEN_14_1[`${scene}/${detailLevel}`]!;
        expect({ hash: hashBytes(new Uint8Array(path.coords.buffer, path.coords.byteOffset, path.coords.byteLength)), points: path.coords.length / 2 }).toEqual({ hash: old.hash, points: old.points });
      });

      it(`${scene} / ${detailLevel} without structureToneBalance is still the pre-14.1 path`, () => {
        const image = make();
        const analysis = analyzeImage(image, undefined, 'img-golden');
        const effective = resolveOneLineSettings({ detailLevel, seed: 7 }, TEST_PARAMETERS);
        const { structureToneBalance: _balance, ...pre141 } = withoutSpacing(effective.parameters);
        expect(_balance).toBeGreaterThan(0);
        const { path } = generateOneLine({ image, analysis, settings: effective.settings }, pre141, { rng: createRandom(effective.settings.seed) });
        const old = detailLevel === 'detail' ? GOLDEN_13_1[scene]! : GOLDEN[`${scene}/${detailLevel}`]!;
        expect({ hash: hashBytes(new Uint8Array(path.coords.buffer, path.coords.byteOffset, path.coords.byteLength)), points: path.coords.length / 2 }).toEqual({ hash: old.hash, points: old.points });
      });
    }
  }

  for (const [scene, make] of Object.entries(SCENES)) {
    it(`${scene} / detail without lightDetail (and structureToneBalance) is still the phase-12 path`, () => {
      const image = make();
      const analysis = analyzeImage(image, undefined, 'img-golden');
      const effective = resolveOneLineSettings({ detailLevel: 'detail', seed: 7 }, TEST_PARAMETERS);
      const { lightDetail: _light, structureToneBalance: _balance, ...phase12 } = withoutSpacing(effective.parameters);
      expect(_light).toBe(0.8);
      expect(_balance).toBe(0.75);
      const { path } = generateOneLine({ image, analysis, settings: effective.settings }, phase12, { rng: createRandom(effective.settings.seed) });
      const old = GOLDEN[`${scene}/detail`]!;
      expect({ hash: hashBytes(new Uint8Array(path.coords.buffer, path.coords.byteOffset, path.coords.byteLength)), points: path.coords.length / 2 }).toEqual({ hash: old.hash, points: old.points });
    });
  }
});
