import { describe, expect, it } from 'vitest';
import { IDLE_EXPORT_STATE, exportReducer, isExportRunning, type ExportEvent, type ExportState } from '../../../src/core';

const run = (events: ExportEvent<string>[], from: ExportState<string> = IDLE_EXPORT_STATE) => events.reduce(exportReducer<string>, from);
const file = { fileName: 'a.png', mimeType: 'image/png', sizeBytes: 3, data: 'bytes' };

describe('export state', () => {
  it('idle → preparing → rendering → encoding → ready', () => {
    const s = run([
      { type: 'started', jobId: 1, kind: 'video' },
      { type: 'phase', jobId: 1, phase: 'rendering' },
      { type: 'progress', jobId: 1, progress: 0.5 },
      { type: 'phase', jobId: 1, phase: 'encoding' },
      { type: 'succeeded', jobId: 1, file },
    ]);
    expect(s).toMatchObject({ status: 'ready', kind: 'video', progress: 1, file, error: null });
    expect(isExportRunning(s)).toBe(false);
  });

  it('phases never go back, progress never decreases and is clamped', () => {
    let s = run([
      { type: 'started', jobId: 1, kind: 'video' },
      { type: 'phase', jobId: 1, phase: 'encoding' },
      { type: 'phase', jobId: 1, phase: 'rendering' },
      { type: 'progress', jobId: 1, progress: 0.6 },
      { type: 'progress', jobId: 1, progress: 0.4 },
    ]);
    expect(s.status).toBe('encoding');
    expect(s.progress).toBe(0.6);
    s = run([{ type: 'progress', jobId: 1, progress: 7 }], s);
    expect(s.progress).toBe(1);
    s = run([{ type: 'progress', jobId: 1, progress: Number.NaN }], s);
    expect(s.progress).toBe(1);
  });

  it('failure and cancel end the job; late events of it are ignored', () => {
    const failed = run([
      { type: 'started', jobId: 1, kind: 'image' },
      { type: 'failed', jobId: 1, error: 'out-of-memory' },
      { type: 'succeeded', jobId: 1, file },
    ]);
    expect(failed).toMatchObject({ status: 'failed', error: 'out-of-memory', file: null });

    const cancelled = run([
      { type: 'started', jobId: 1, kind: 'video' },
      { type: 'phase', jobId: 1, phase: 'rendering' },
      { type: 'cancelled', jobId: 1 },
      // e.g. the encoder resolves after "Abbrechen":
      { type: 'succeeded', jobId: 1, file },
      { type: 'progress', jobId: 1, progress: 0.9 },
    ]);
    expect(cancelled).toMatchObject({ status: 'cancelled', file: null });
    expect(run([{ type: 'started', jobId: 1, kind: 'video' }, { type: 'failed', jobId: 1, error: 'cancelled' }]).status).toBe('cancelled');
  });

  it('one export at a time; events of other jobs are ignored', () => {
    const s = run([
      { type: 'started', jobId: 1, kind: 'image' },
      { type: 'started', jobId: 2, kind: 'video' },
      { type: 'progress', jobId: 2, progress: 0.5 },
    ]);
    expect(s).toMatchObject({ jobId: 1, kind: 'image', progress: 0 });
    const next = run([{ type: 'succeeded', jobId: 1, file }, { type: 'started', jobId: 2, kind: 'video' }], s);
    expect(next).toMatchObject({ jobId: 2, status: 'preparing', file: null });
    // Stale job ids cannot restart.
    expect(run([{ type: 'reset' }, { type: 'started', jobId: 1, kind: 'image' }], next)).toBe(next);
  });

  it('reset only when nothing runs', () => {
    const running = run([{ type: 'started', jobId: 1, kind: 'image' }]);
    expect(run([{ type: 'reset' }], running)).toBe(running);
    const done = run([{ type: 'succeeded', jobId: 1, file }, { type: 'reset' }], running);
    expect(done).toMatchObject({ status: 'idle', jobId: 1, file: null });
  });
});
