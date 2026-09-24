import { describe, expect, it } from 'vitest';
import {
  EMPTY_IMPORT_STATE,
  createRandom,
  uniformAnalyzer,
  belongsToSession,
  requireAnalysisSource,
  importReducer,
  resolveOneLineSettings,
  sessionKeyOf,
  IDENTITY_EDIT,
  type ImageEdit,
  type ProcessedImage,
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
  const pathFor = (imageId: string, width = 4, height = 3, x = 1) => ({
    coords: new Float32Array([0, 0, x, 1]),
    bounds: { width, height },
    meta: { generatorId: 'test', generatorVersion: '1', seed: 1, sourceImageId: imageId },
  });
  const session = (state: ImportState<Preview>) => {
    if (state.status !== 'ready') throw new Error('not ready');
    return state.session;
  };
  const keyOf = (state: ImportState<Preview>) => session(state).oneLine.key;

  it('starts idle with Balanced as the default drawing configuration', () => {
    const s = session(analysed());
    expect(s.pathStatus).toBe('idle');
    expect(s.path).toBeNull();
    expect(s.oneLine.drawing.detailLevel).toBe('balanced');
  });

  it('idle → running → ready stores the path under its configuration key', () => {
    const state = analysed();
    const key = keyOf(state);
    const s = session(run([{ type: 'path-started', imageId: 'a', key }, { type: 'path-succeeded', imageId: 'a', key, path: pathFor('a') }], state));
    expect(s.pathStatus).toBe('ready');
    expect(s.path?.meta.sourceImageId).toBe('a');
    expect(s.paths[key]).toBe(s.path);
  });

  it('requires a finished analysis', () => {
    const state = run(loadImage(1, 'a'));
    const s = session(importReducer(state, { type: 'path-started', imageId: 'a', key: keyOf(state) }));
    expect(s.pathStatus).toBe('failed');
    expect(s.pathError).toBe('analysis-missing');
  });

  it('never accepts a path of another image', () => {
    let state = analysed();
    const key = keyOf(state);
    state = run([{ type: 'path-started', imageId: 'a', key }], state);
    state = importReducer(state, { type: 'path-succeeded', imageId: 'a', key, path: pathFor('other') });
    expect(session(state).path).toBeNull();
    state = run(loadImage(2, 'b'), state);
    state = importReducer(state, { type: 'path-succeeded', imageId: 'a', key, path: pathFor('a') });
    expect(session(state).original.id).toBe('b');
    expect(session(state).path).toBeNull();
    expect(session(state).paths).toEqual({});
  });

  it('rejects a path for a different canvas size', () => {
    const state = analysed();
    const key = keyOf(state);
    const s = session(run([{ type: 'path-started', imageId: 'a', key }, { type: 'path-succeeded', imageId: 'a', key, path: pathFor('a', 9, 9) }], state));
    expect(s.pathStatus).toBe('failed');
    expect(s.pathError).toBe('invalid-result');
  });

  it('records failures and allows another attempt', () => {
    const state0 = analysed();
    const key = keyOf(state0);
    let state = run([{ type: 'path-started', imageId: 'a', key }, { type: 'path-failed', imageId: 'a', key, error: 'aborted' }], state0);
    expect(session(state).pathError).toBe('aborted');
    state = importReducer(state, { type: 'path-started', imageId: 'a', key });
    expect(session(state).pathStatus).toBe('running');
  });

  describe('detail level changes', () => {
    it('a new configuration makes the old path non-current, but keeps it cached', () => {
      const state0 = analysed();
      const balanced = keyOf(state0);
      let state = run([{ type: 'path-started', imageId: 'a', key: balanced }, { type: 'path-succeeded', imageId: 'a', key: balanced, path: pathFor('a') }], state0);
      state = importReducer(state, { type: 'drawing-changed', imageId: 'a', drawing: { detailLevel: 'detail' } });
      const s = session(state);
      expect(s.oneLine.drawing.detailLevel).toBe('detail');
      expect(s.oneLine.key).not.toBe(balanced);
      expect(s.path).toBeNull();
      expect(s.pathStatus).toBe('idle');
      expect(s.paths[balanced]).toBeDefined();
      // Switching back is instant.
      const back = session(importReducer(state, { type: 'drawing-changed', imageId: 'a', drawing: { detailLevel: 'balanced' } }));
      expect(back.pathStatus).toBe('ready');
      expect(back.path).toBe(s.paths[balanced]);
    });

    it('14. changing the level never touches the analysis', () => {
      const state0 = analysed();
      const before = session(state0);
      const after = session(importReducer(state0, { type: 'drawing-changed', imageId: 'a', drawing: { detailLevel: 'minimal' } }));
      expect(after.analysis).toBe(before.analysis);
      expect(after.analysisStatus).toBe('ready');
      expect(after.processed).toBe(before.processed);
    });

    it('a late result for a previous configuration is cached but never shown as current', () => {
      const state0 = analysed();
      const balanced = keyOf(state0);
      let state = run([{ type: 'path-started', imageId: 'a', key: balanced }], state0);
      state = importReducer(state, { type: 'drawing-changed', imageId: 'a', drawing: { detailLevel: 'minimal' } });
      state = importReducer(state, { type: 'path-succeeded', imageId: 'a', key: balanced, path: pathFor('a') });
      expect(session(state).path).toBeNull();
      expect(session(state).oneLine.drawing.detailLevel).toBe('minimal');
      expect(session(state).paths[balanced]).toBeDefined();
    });

    it('a new image starts again at Balanced with no cached paths', () => {
      let state = importReducer(analysed(), { type: 'drawing-changed', imageId: 'a', drawing: { detailLevel: 'detail', seed: 9 } });
      state = run(loadImage(2, 'b'), state);
      expect(session(state).oneLine.drawing.detailLevel).toBe('balanced');
      expect(session(state).oneLine.drawing.seed).toBe(1);
      expect(session(state).paths).toEqual({});
    });

    it('changing the seed is a different configuration', () => {
      const state0 = analysed();
      const s = session(importReducer(state0, { type: 'drawing-changed', imageId: 'a', drawing: { seed: 2 } }));
      expect(s.oneLine.key).not.toBe(keyOf(state0));
    });
  });
});

describe('reopening a stored project', () => {
  const stored = (id: string, width = 4, height = 3) => ({
    oneLine: resolveOneLineSettings({ detailLevel: 'detail', seed: 9 }),
    path: { coords: new Float32Array([0, 0, 3, 2]), bounds: { width, height }, meta: { generatorId: 'g', generatorVersion: '1', seed: 9, sourceImageId: id } },
  });
  const open = (restore: ReturnType<typeof stored>) =>
    run([
      { type: 'import-started', requestId: 1, fileName: 'a.jpg' },
      { type: 'import-succeeded', requestId: 1, image: imported('a'), restore },
    ]);

  it('uses the stored drawing as is; analysis is deferred', () => {
    const restore = stored('a');
    const s = open(restore);
    if (s.status !== 'ready') throw new Error('not ready');
    expect(s.session).toMatchObject({ analysisStatus: 'deferred', pathStatus: 'ready', oneLine: restore.oneLine });
    expect(s.session.path).toBe(restore.path);
    expect(s.session.paths[restore.oneLine.key]).toBe(restore.path);
  });

  it('switching to another level starts the analysis; back to the stored one needs none', () => {
    const restore = stored('a');
    let s = open(restore);
    s = run([{ type: 'drawing-changed', imageId: 'a', drawing: { detailLevel: 'minimal' } }], s);
    if (s.status !== 'ready') throw new Error('not ready');
    expect(s.session).toMatchObject({ analysisStatus: 'pending', pathStatus: 'idle', path: null });
    s = run([{ type: 'drawing-changed', imageId: 'a', drawing: { detailLevel: 'detail' } }], s);
    if (s.status !== 'ready') throw new Error('not ready');
    expect(s.session.path).toBe(restore.path);
  });

  it('a drawing that does not fit the image is not restored', () => {
    for (const restore of [stored('other'), stored('a', 5, 3)]) {
      const s = open(restore);
      if (s.status !== 'ready') throw new Error('not ready');
      expect(s.session).toMatchObject({ analysisStatus: 'pending', pathStatus: 'idle', path: null, paths: {} });
    }
  });
});

describe('image edits in the session', () => {
  const sessionOf = (state: ImportState<Preview>) => {
    if (state.status !== 'ready') throw new Error(`expected ready, got ${state.status}`);
    return state.session;
  };
  const analysisFor = (imageId: string, width = 4, height = 3) => {
    const a = uniformAnalyzer.analyze({ width, height, data: new Uint8ClampedArray(width * height * 4) }, createRandom(1));
    return { ...a, meta: { ...a.meta, sourceImageId: imageId, sourceSize: { width, height } } };
  };
  const rotated: ImportAction<Preview> = {
    type: 'edit-applied',
    imageId: 'a',
    edit: { rotation: 90, crop: { x: 0, y: 0, width: 1, height: 1 } },
    preview: { tag: 'a-rotated' },
    processed: { sourceImageId: 'a', pixels: { width: 3, height: 4, data: new Uint8ClampedArray(48) }, scale: 1 },
  };
  const analysed = () => {
    const s = run([...loadImage(1, 'a'), { type: 'analysis-started', imageId: 'a' }, { type: 'analysis-succeeded', imageId: 'a', analysis: analysisFor('a') }]);
    expect(sessionOf(s).analysisStatus).toBe('ready');
    return s;
  };

  it('a new image is unedited; its unedited display copy is kept', () => {
    const s = sessionOf(run(loadImage(1, 'a')));
    expect(s.edit).toEqual(IDENTITY_EDIT);
    expect(s.revision).toBe(0);
    expect(sessionKeyOf(s)).toBe('a');
    expect(s.sourcePreview).toBe(s.preview);
  });

  it('an edit is a new input: analysis and paths are dropped and must be computed again', () => {
    const base = analysed();
    const before = sessionOf(base);
    const s = sessionOf(run([rotated], base));
    expect(s.edit.rotation).toBe(90);
    expect(s.processed.pixels).toMatchObject({ width: 3, height: 4 });
    expect(s.preview).toEqual({ tag: 'a-rotated' });
    expect(s.sourcePreview).toBe(before.sourcePreview); // the unedited copy stays
    expect(s.original).toBe(before.original); // the original is untouched
    expect(s.analysisStatus).toBe('pending');
    expect(s.analysis).toBeNull();
    expect(s.paths).toEqual({});
    expect(s.pathStatus).toBe('idle');
    expect(s.oneLine).toBe(before.oneLine); // drawing settings stay
    expect(sessionKeyOf(s)).toBe('a@1');
  });

  it('results of the previous edit are never accepted', () => {
    const edited = run([rotated], analysed());
    // A late analysis of the unedited image (address 'a') is ignored.
    const late = run([{ type: 'analysis-started', imageId: 'a' }, { type: 'analysis-succeeded', imageId: 'a', analysis: analysisFor('a') }], edited);
    expect(sessionOf(late).analysisStatus).toBe('pending');
    // The analysis of the edited input is accepted.
    const ok = run([{ type: 'analysis-started', imageId: 'a@1' }, { type: 'analysis-succeeded', imageId: 'a@1', analysis: analysisFor('a', 3, 4) }], edited);
    expect(sessionOf(ok).analysisStatus).toBe('ready');
    // Edits addressed to an older revision are ignored too.
    expect(run([{ ...rotated, preview: { tag: 'stale' } }], edited)).toBe(edited);
  });

  it('a reopened project brings its edit (already applied) and its stored drawing', () => {
    const oneLine = resolveOneLineSettings();
    const path = { coords: new Float32Array([0, 0, 3, 4]), bounds: { width: 3, height: 4 }, meta: { generatorId: 'x', generatorVersion: '1', seed: 1, sourceImageId: 'a' } };
    const s = sessionOf(
      run([
        { type: 'import-started', requestId: 1, fileName: 'a.jpg' },
        {
          type: 'import-succeeded',
          requestId: 1,
          image: imported('a'),
          restore: { oneLine, path },
          edited: { edit: (rotated as { edit: ImageEdit }).edit, preview: { tag: 'a-rotated' }, processed: (rotated as { processed: ProcessedImage }).processed },
        },
      ]),
    );
    expect(s.edit.rotation).toBe(90);
    expect(s.pathStatus).toBe('ready');
    expect(s.path).toBe(path);
    expect(s.analysisStatus).toBe('deferred');
    expect(s.sourcePreview).toEqual({ tag: 'a' });
  });
});

describe('stale results across edits and images', () => {
  const sessionOf = (state: ImportState<Preview>) => {
    if (state.status !== 'ready') throw new Error(`expected ready, got ${state.status}`);
    return state.session;
  };
  const analysisFor = (imageId: string, width = 4, height = 3) => {
    const a = uniformAnalyzer.analyze({ width, height, data: new Uint8ClampedArray(width * height * 4) }, createRandom(1));
    return { ...a, meta: { ...a.meta, sourceImageId: imageId, sourceSize: { width, height } } };
  };
  const path = (imageId: string) => ({ coords: new Float32Array([0, 0, 4, 3]), bounds: { width: 4, height: 3 }, meta: { generatorId: 'x', generatorVersion: '1', seed: 1, sourceImageId: imageId } });

  it('image A analysed, edited, then image B: late results of A (before or after the edit) never reach B', () => {
    const edited: ImportAction<Preview> = {
      type: 'edit-applied',
      imageId: 'a',
      edit: { rotation: 180, crop: { x: 0, y: 0, width: 1, height: 1 } },
      preview: { tag: 'a2' },
      processed: { sourceImageId: 'a', pixels: { width: 4, height: 3, data: new Uint8ClampedArray(48) }, scale: 1 },
    };
    let state = run([...loadImage(1, 'a'), { type: 'analysis-started', imageId: 'a' }, edited, { type: 'analysis-started', imageId: 'a@1' }]);
    state = run(loadImage(2, 'b'), state);
    state = run([{ type: 'analysis-started', imageId: 'b' }], state);
    const late: ImportAction<Preview>[] = [
      { type: 'analysis-succeeded', imageId: 'a', analysis: analysisFor('a') },
      { type: 'analysis-succeeded', imageId: 'a@1', analysis: analysisFor('a') },
      { type: 'path-succeeded', imageId: 'a@1', key: sessionOf(state).oneLine.key, path: path('a') },
      { type: 'analysis-failed', imageId: 'a', error: 'analysis-failed' },
    ];
    const after = run(late, state);
    expect(after).toBe(state);
    const s = sessionOf(after);
    expect(s.original.id).toBe('b');
    expect(s.analysisStatus).toBe('running');
    expect(s.paths).toEqual({});
    // B's own result is accepted.
    expect(sessionOf(run([{ type: 'analysis-succeeded', imageId: 'b', analysis: analysisFor('b') }], after)).analysisStatus).toBe('ready');
  });
});

describe('13.8 defaults for a new image', () => {
  it('a new image starts with the given drawing defaults (style, detail)', () => {
    const state = run([
      { type: 'import-started', requestId: 1, fileName: 'a.jpg' },
      { type: 'import-succeeded', requestId: 1, image: imported('a'), drawing: { ...resolveOneLineSettings().drawing, style: 'orthogonal', detailLevel: 'detail' } },
    ]);
    if (state.status !== 'ready') throw new Error('not ready');
    expect(state.session.oneLine.drawing).toMatchObject({ style: 'orthogonal', detailLevel: 'detail' });
    expect(state.session.oneLine.key).toBe(resolveOneLineSettings({ style: 'orthogonal', detailLevel: 'detail' }).key);
  });

  it('without defaults: exactly as before (Organic, Balanced)', () => {
    const state = run(loadImage(1, 'a'));
    if (state.status !== 'ready') throw new Error('not ready');
    expect(state.session.oneLine.key).toBe(resolveOneLineSettings().key);
  });

  it('a restored drawing (reopened work) always wins over the defaults', () => {
    const stored = resolveOneLineSettings({ style: 'geometric', detailLevel: 'minimal' });
    const path = { coords: new Float32Array([0, 0, 4, 3]), bounds: { width: 4, height: 3 }, meta: { generatorId: 'g', generatorVersion: '1', seed: 1, sourceImageId: 'a' } };
    const state = run([
      { type: 'import-started', requestId: 1, fileName: 'a.jpg' },
      { type: 'import-succeeded', requestId: 1, image: imported('a'), restore: { oneLine: stored, path }, drawing: { ...resolveOneLineSettings().drawing, style: 'orthogonal' } },
    ]);
    if (state.status !== 'ready') throw new Error('not ready');
    expect(state.session.oneLine).toBe(stored);
    expect(state.session.path).toBe(path);
  });
});
