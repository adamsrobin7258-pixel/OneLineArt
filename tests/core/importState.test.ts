import { describe, expect, it } from 'vitest';
import {
  EMPTY_IMPORT_STATE,
  createRandom,
  uniformAnalyzer,
  belongsToSession,
  requireAnalysisSource,
  importReducer,
  type ImportAction,
  type ImportState,
  type ImportedImage,
} from '../../src/core';

type Preview = { tag: string };

function imported(id: string): ImportedImage<Preview> {
  return {
    original: {
      id,
      fileName: `${id}.jpg`,
      source: new Blob([]),
      metadata: { format: 'jpeg', mimeType: 'image/jpeg', fileSizeBytes: 1, width: 4, height: 3, aspectRatio: 4 / 3, orientation: 1 },
      contentHash: '0',
    },
    processed: { sourceImageId: id, pixels: { width: 4, height: 3, data: new Uint8ClampedArray(48) }, scale: 1 },
    preview: { tag: id },
  };
}

const run = (actions: ImportAction<Preview>[], from: ImportState<Preview> = EMPTY_IMPORT_STATE) => actions.reduce(importReducer<Preview>, from);

const loadImage = (requestId: number, id: string): ImportAction<Preview>[] => [
  { type: 'import-started', requestId, fileName: `${id}.jpg` },
  { type: 'processing-started', requestId },
  { type: 'import-succeeded', requestId, image: imported(id) },
];

describe('import state', () => {
  it('starts EMPTY', () => {
    expect(EMPTY_IMPORT_STATE.status).toBe('empty');
  });

  it('goes EMPTY → LOADING → PROCESSING → READY', () => {
    const statuses: string[] = [];
    let state: ImportState<Preview> = EMPTY_IMPORT_STATE;
    for (const action of loadImage(1, 'a')) {
      state = importReducer(state, action);
      statuses.push(state.status);
    }
    expect(statuses).toEqual(['loading', 'processing', 'ready']);
    expect(state.status === 'ready' && state.session.original.id).toBe('a');
    expect(state.status === 'ready' && state.session.analysis).toBeNull();
    expect(state.status === 'ready' && state.session.path).toBeNull();
  });

  it('goes to ERROR on failure, keeping the file name for context', () => {
    const state = run([
      { type: 'import-started', requestId: 1, fileName: 'x.gif' },
      { type: 'import-failed', requestId: 1, error: 'unsupported-format' },
    ]);
    expect(state).toEqual({ status: 'error', error: 'unsupported-format', fileName: 'x.gif' });
  });

  it('image change: the new image replaces the whole session (no stale analysis/path)', () => {
    const ready = run(loadImage(1, 'a'));
    // Simulate results from later parts attached to image "a".
    const withResults: ImportState<Preview> =
      ready.status === 'ready'
        ? { status: 'ready', session: { ...ready.session, analysisStatus: 'ready', analysis: uniformAnalyzer.analyze(ready.session.processed.pixels, createRandom(1)), path: null } }
        : ready;

    const loading = importReducer(withResults, { type: 'import-started', requestId: 2, fileName: 'b.jpg' });
    expect(loading.status).toBe('loading'); // old image is gone immediately

    const next = run(loadImage(2, 'b').slice(1), loading);
    expect(next.status).toBe('ready');
    if (next.status !== 'ready') return;
    expect(next.session.original.id).toBe('b');
    expect(next.session.processed.sourceImageId).toBe('b');
    expect(next.session.analysis).toBeNull();
    expect(next.session.path).toBeNull();
    expect(belongsToSession(next.session, 'a')).toBe(false);
    expect(belongsToSession(next.session, 'b')).toBe(true);
  });

  it('ignores results of a superseded import', () => {
    const state = run([
      { type: 'import-started', requestId: 1, fileName: 'slow.jpg' },
      { type: 'import-started', requestId: 2, fileName: 'fast.jpg' },
      { type: 'import-succeeded', requestId: 2, image: imported('fast') },
      { type: 'import-succeeded', requestId: 1, image: imported('slow') },
      { type: 'import-failed', requestId: 1, error: 'corrupt' },
    ]);
    expect(state.status === 'ready' && state.session.original.id).toBe('fast');
  });

  it('remove image returns to EMPTY from any state', () => {
    for (const from of [run(loadImage(1, 'a')), run(loadImage(1, 'a').slice(0, 1)), run([{ type: 'import-started', requestId: 1, fileName: 'x' }, { type: 'import-failed', requestId: 1, error: 'corrupt' }])]) {
      expect(importReducer(from, { type: 'image-removed' })).toEqual({ status: 'empty' });
    }
  });

  it('ignores a late result after the image was removed', () => {
    const state = run([{ type: 'import-started', requestId: 1, fileName: 'a.jpg' }, { type: 'image-removed' }, ...loadImage(1, 'a').slice(1)]);
    expect(state).toEqual({ status: 'empty' });
  });

  it('cancelled file selection dispatches nothing, so state is unchanged', () => {
    // The picker yields no file on cancel; the controller then does not dispatch.
    const ready = run(loadImage(1, 'a'));
    expect(run([], ready)).toBe(ready);
  });
});

describe('analysis in the image session', () => {
  const ready = () => run(loadImage(1, 'a'));
  const analysisFor = (imageId: string | null, width = 4, height = 3) => {
    const a = uniformAnalyzer.analyze({ width, height, data: new Uint8ClampedArray(width * height * 4) }, createRandom(1));
    return { ...a, meta: { ...a.meta, sourceImageId: imageId, sourceSize: { width, height } } };
  };
  const sessionOf = (state: ImportState<Preview>) => {
    if (state.status !== 'ready') throw new Error(`expected ready, got ${state.status}`);
    return state.session;
  };

  it('a new image starts with a pending analysis and no results', () => {
    const s = sessionOf(ready());
    expect(s.analysisStatus).toBe('pending');
    expect(s.analysis).toBeNull();
    expect(s.analysisError).toBeNull();
  });

  it('pending → running → ready stores the analysis', () => {
    const s = sessionOf(
      run(
        [
          { type: 'analysis-started', imageId: 'a' },
          { type: 'analysis-succeeded', imageId: 'a', analysis: analysisFor('a') },
        ],
        ready(),
      ),
    );
    expect(s.analysisStatus).toBe('ready');
    expect(s.analysis?.meta.sourceImageId).toBe('a');
  });

  it('12. image change: a late analysis of the previous image is never used', () => {
    let state = run([{ type: 'analysis-started', imageId: 'a' }], ready());
    state = run(loadImage(2, 'b'), state);
    state = importReducer(state, { type: 'analysis-succeeded', imageId: 'a', analysis: analysisFor('a') });
    expect(sessionOf(state).original.id).toBe('b');
    expect(sessionOf(state).analysis).toBeNull();
    expect(sessionOf(state).analysisStatus).toBe('pending');
  });

  it('rejects an analysis whose metadata names another image, even if addressed correctly', () => {
    const state = run(
      [
        { type: 'analysis-started', imageId: 'a' },
        { type: 'analysis-succeeded', imageId: 'a', analysis: analysisFor('other') },
      ],
      ready(),
    );
    expect(sessionOf(state).analysis).toBeNull();
  });

  it('fails an analysis whose size does not match the working copy', () => {
    const state = run(
      [
        { type: 'analysis-started', imageId: 'a' },
        { type: 'analysis-succeeded', imageId: 'a', analysis: analysisFor('a', 9, 9) },
      ],
      ready(),
    );
    expect(sessionOf(state).analysisStatus).toBe('failed');
    expect(sessionOf(state).analysisError).toBe('unexpected-dimensions');
  });

  it('failure and retry', () => {
    let state = run(
      [
        { type: 'analysis-started', imageId: 'a' },
        { type: 'analysis-failed', imageId: 'a', error: 'out-of-memory' },
      ],
      ready(),
    );
    expect(sessionOf(state).analysisError).toBe('out-of-memory');
    state = importReducer(state, { type: 'analysis-retry', imageId: 'a' });
    expect(sessionOf(state).analysisStatus).toBe('pending');
    expect(sessionOf(state).analysisError).toBeNull();
  });

  it('removing the image drops the analysis', () => {
    const state = run(
      [
        { type: 'analysis-started', imageId: 'a' },
        { type: 'analysis-succeeded', imageId: 'a', analysis: analysisFor('a') },
        { type: 'image-removed' },
      ],
      ready(),
    );
    expect(state).toEqual({ status: 'empty' });
  });

  it('analysis actions without an image are ignored; requireAnalysisSource reports no-image', () => {
    expect(importReducer(EMPTY_IMPORT_STATE, { type: 'analysis-started', imageId: 'a' })).toBe(EMPTY_IMPORT_STATE);
    expect(() => requireAnalysisSource(EMPTY_IMPORT_STATE)).toThrow(expect.objectContaining({ code: 'no-image' }));
  });

  it('requireAnalysisSource reports unavailable pixel data', () => {
    const state = ready();
    const s = sessionOf(state);
    const broken: ImportState<Preview> = { status: 'ready', session: { ...s, processed: { ...s.processed, pixels: { width: 4, height: 3, data: new Uint8ClampedArray(0) } } } };
    expect(() => requireAnalysisSource(broken)).toThrow(expect.objectContaining({ code: 'image-unavailable' }));
    expect(requireAnalysisSource(state)).toBe(s.processed);
  });
});

describe('One-Line path in the image session', () => {
  const analysed = () =>
    run(
      [
        { type: 'analysis-started', imageId: 'a' },
        {
          type: 'analysis-succeeded',
          imageId: 'a',
          analysis: (() => {
            const an = uniformAnalyzer.analyze({ width: 4, height: 3, data: new Uint8ClampedArray(48) }, createRandom(1));
            return { ...an, meta: { ...an.meta, sourceImageId: 'a', sourceSize: { width: 4, height: 3 } } };
          })(),
        },
      ],
      run(loadImage(1, 'a')),
    );
  const pathFor = (imageId: string, width = 4, height = 3) => ({
    coords: new Float32Array([0, 0, 1, 1]),
    bounds: { width, height },
    meta: { generatorId: 'test', generatorVersion: '1', seed: 1, sourceImageId: imageId },
  });
  const session = (state: ImportState<Preview>) => {
    if (state.status !== 'ready') throw new Error('not ready');
    return state.session;
  };

  it('starts idle; generation is on request only', () => {
    expect(session(analysed()).pathStatus).toBe('idle');
    expect(session(analysed()).path).toBeNull();
  });

  it('idle → running → ready stores the path', () => {
    const s = session(run([{ type: 'path-started', imageId: 'a' }, { type: 'path-succeeded', imageId: 'a', path: pathFor('a') }], analysed()));
    expect(s.pathStatus).toBe('ready');
    expect(s.path?.meta.sourceImageId).toBe('a');
  });

  it('requires a finished analysis', () => {
    const s = session(importReducer(run(loadImage(1, 'a')), { type: 'path-started', imageId: 'a' }));
    expect(s.pathStatus).toBe('failed');
    expect(s.pathError).toBe('analysis-missing');
  });

  it('never accepts a path of another image', () => {
    let state = run([{ type: 'path-started', imageId: 'a' }], analysed());
    state = importReducer(state, { type: 'path-succeeded', imageId: 'a', path: pathFor('other') });
    expect(session(state).path).toBeNull();
    state = run(loadImage(2, 'b'), state);
    state = importReducer(state, { type: 'path-succeeded', imageId: 'a', path: pathFor('a') });
    expect(session(state).original.id).toBe('b');
    expect(session(state).path).toBeNull();
  });

  it('rejects a path for a different canvas size', () => {
    const s = session(run([{ type: 'path-started', imageId: 'a' }, { type: 'path-succeeded', imageId: 'a', path: pathFor('a', 9, 9) }], analysed()));
    expect(s.pathStatus).toBe('failed');
    expect(s.pathError).toBe('invalid-result');
  });

  it('records failures and allows another attempt', () => {
    let state = run([{ type: 'path-started', imageId: 'a' }, { type: 'path-failed', imageId: 'a', error: 'aborted' }], analysed());
    expect(session(state).pathError).toBe('aborted');
    state = importReducer(state, { type: 'path-started', imageId: 'a' });
    expect(session(state).pathStatus).toBe('running');
  });
});
