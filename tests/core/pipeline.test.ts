import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ONE_LINE_SETTINGS,
  createPath,
  placeholderGenerator,
  pointCount,
  runOneLinePipeline,
  uniformAnalyzer,
  type OneLinePathGenerator,
} from '../../src/core';
import { blankImage } from '../helpers';

const config = { analyzer: uniformAnalyzer, generator: placeholderGenerator };

describe('one-line pipeline', () => {
  it('is deterministic: same image + same settings => identical path', () => {
    const a = runOneLinePipeline(config, blankImage(), DEFAULT_ONE_LINE_SETTINGS);
    const b = runOneLinePipeline(config, blankImage(), DEFAULT_ONE_LINE_SETTINGS);
    expect(a.coords).toEqual(b.coords);
    expect(a.meta).toEqual(b.meta);
  });

  it('changes with the seed', () => {
    const a = runOneLinePipeline(config, blankImage(), { ...DEFAULT_ONE_LINE_SETTINGS, seed: 1 });
    const b = runOneLinePipeline(config, blankImage(), { ...DEFAULT_ONE_LINE_SETTINGS, seed: 2 });
    expect(a.coords).not.toEqual(b.coords);
  });

  it('records provenance and image bounds', () => {
    const path = runOneLinePipeline(config, blankImage(64, 48), { ...DEFAULT_ONE_LINE_SETTINGS, seed: 9 });
    expect(path.bounds).toEqual({ width: 64, height: 48 });
    expect(path.meta).toEqual({ generatorId: placeholderGenerator.id, generatorVersion: placeholderGenerator.version, seed: 9 });
  });

  it('respects maxPoints', () => {
    const path = runOneLinePipeline(config, blankImage(), { ...DEFAULT_ONE_LINE_SETTINGS, detail: 1, maxPoints: 50 });
    expect(pointCount(path)).toBe(50);
  });

  it('runs stages in order and passes the analysis to the generator', () => {
    const calls: string[] = [];
    const generator: OneLinePathGenerator = {
      id: 'spy',
      version: '1',
      generate(input) {
        calls.push('generate');
        expect(input.analysis.importance.width).toBe(input.image.width);
        return createPath([{ x: 0, y: 0 }, { x: 1, y: 1 }], input.image, { generatorId: 'spy', generatorVersion: '1', seed: 0 });
      },
    };
    runOneLinePipeline(
      {
        preprocess: [{ kind: 'noop', apply: (img) => (calls.push('preprocess'), img) }],
        analyzer: { id: 'a', analyze: (img, rng) => (calls.push('analyze'), uniformAnalyzer.analyze(img, rng)) },
        generator,
        optimizers: [{ id: 'o', optimize: (p) => (calls.push('optimize'), p) }],
      },
      blankImage(),
      DEFAULT_ONE_LINE_SETTINGS,
    );
    expect(calls).toEqual(['preprocess', 'analyze', 'generate', 'optimize']);
  });

  it('rejects generators that produce an invalid path', () => {
    const broken: OneLinePathGenerator = {
      id: 'broken',
      version: '1',
      generate: (input) => createPath([{ x: 0, y: 0 }], input.image, { generatorId: 'broken', generatorVersion: '1', seed: 0 }),
    };
    expect(() => runOneLinePipeline({ analyzer: uniformAnalyzer, generator: broken }, blankImage(), DEFAULT_ONE_LINE_SETTINGS)).toThrow(
      /invalid path/,
    );
  });
});
