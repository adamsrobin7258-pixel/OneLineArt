import { describe, expect, it } from 'vitest';
import {
  EMPTY_IMPORT_STATE,
  belongsToSession,
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
        ? { status: 'ready', session: { ...ready.session, analysis: { importance: { width: 1, height: 1, data: new Float32Array(1) } }, path: null } }
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
