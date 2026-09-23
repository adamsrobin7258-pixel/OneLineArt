import { describe, expect, it } from 'vitest';
import { EXPORT_LIMITS, ExportError, FRAME_PROGRESS_SHARE, planVideoFrames, runVideoExport, type VideoEncodingSession } from '../../../src/core';

function fakeSession(opts: { failAt?: number; empty?: boolean } = {}) {
  const log: string[] = [];
  const frames: { t: number; d: number }[] = [];
  let pending = 0;
  let maxPending = 0;
  const session: VideoEncodingSession<string> = {
    async addFrame(t, d) {
      pending++;
      maxPending = Math.max(maxPending, pending);
      if (opts.failAt === frames.length) throw new Error('encoder broke');
      frames.push({ t, d });
      await Promise.resolve();
      pending--;
    },
    async finish() {
      log.push('finish');
      return { data: 'video', sizeBytes: opts.empty ? 0 : 1234, mimeType: 'video/webm' };
    },
    async cancel() {
      log.push('cancel');
    },
  };
  return { session, log, frames, maxPending: () => maxPending };
}

describe('video frame plan', () => {
  it('10 s / 30 fps: 301 frames at k/30 s, from 0 ms to exactly 10 000 ms', () => {
    const plan = planVideoFrames({ durationMs: 10_000, fps: 30 });
    expect(plan.frameCount).toBe(301);
    expect(plan.timesMs[0]).toBe(0);
    expect(plan.timesMs[1]).toBeCloseTo(33.333, 3);
    expect(plan.timesMs[2]).toBeCloseTo(66.667, 3);
    expect(plan.timesMs[3]).toBe(100);
    expect(plan.timesMs[299]).toBeCloseTo(9966.667, 3);
    expect(plan.timesMs[300]).toBe(10_000);
    expect(plan.frameDurationMs).toBeCloseTo(1000 / 30, 9);
  });

  it('progress matches the live animation (linear): 0 … 1, last frame complete', () => {
    const plan = planVideoFrames({ durationMs: 5000, fps: 30 });
    expect(plan.progress[0]).toBe(0);
    expect(plan.progress[75]).toBeCloseTo(0.5, 12);
    expect(plan.progress.at(-1)).toBe(1);
    for (let k = 1; k < plan.frameCount; k++) expect(plan.progress[k]!).toBeGreaterThan(plan.progress[k - 1]!);
  });

  it('every duration preset at 30 and 60 fps', () => {
    for (const durationMs of [5000, 10000, 15000, 30000]) {
      for (const fps of [30, 60] as const) {
        const plan = planVideoFrames({ durationMs, fps });
        expect(plan.frameCount).toBe((durationMs / 1000) * fps + 1);
        expect(plan.frameCount).toBeLessThanOrEqual(EXPORT_LIMITS.videoFrames);
      }
    }
  });

  it('is deterministic', () => {
    expect(planVideoFrames({ durationMs: 15_000, fps: 30 })).toEqual(planVideoFrames({ durationMs: 15_000, fps: 30 }));
  });

  it('rejects invalid input', () => {
    expect(() => planVideoFrames({ fps: 24 as never })).toThrow(ExportError);
    expect(() => planVideoFrames({ durationMs: Number.NaN })).toThrow(ExportError);
  });
});

describe('runVideoExport', () => {
  it('renders and encodes every frame in order, one at a time, then finalizes', async () => {
    const plan = planVideoFrames({ durationMs: 5000, fps: 30 });
    const { session, log, frames, maxPending } = fakeSession();
    const rendered: number[] = [];
    const phases: string[] = [];
    const progress: number[] = [];
    const file = await runVideoExport({
      plan,
      session,
      fileName: 'OneLine.webm',
      renderFrame: (p, k) => {
        expect(k).toBe(rendered.length);
        rendered.push(p);
      },
      onPhase: (p) => phases.push(p),
      onProgress: (p) => progress.push(p),
    });
    expect(rendered).toEqual(plan.progress);
    expect(frames.map((f) => f.t)).toEqual(plan.timesMs);
    expect(frames.every((f) => f.d === plan.frameDurationMs)).toBe(true);
    expect(maxPending()).toBe(1); // backpressure: never more than one frame in flight
    expect(log).toEqual(['finish']);
    expect(phases).toEqual(['rendering', 'encoding']);
    expect(progress.at(-2)).toBeCloseTo(FRAME_PROGRESS_SHARE, 12);
    expect(progress.at(-1)).toBe(1);
    expect(file).toEqual({ fileName: 'OneLine.webm', mimeType: 'video/webm', sizeBytes: 1234, data: 'video' });
  });

  it('cancel between frames stops rendering and discards the output', async () => {
    const plan = planVideoFrames({ durationMs: 5000, fps: 30 });
    const { session, log, frames } = fakeSession();
    const signal = { aborted: false };
    const run = runVideoExport({
      plan,
      session,
      fileName: 'x.webm',
      signal,
      renderFrame: (_p, k) => {
        if (k === 10) signal.aborted = true;
      },
    });
    await expect(run).rejects.toMatchObject({ code: 'cancelled' });
    expect(frames).toHaveLength(11);
    expect(log).toEqual(['cancel']);
  });

  it('cancel during finalizing discards the finished file', async () => {
    const plan = planVideoFrames({ durationMs: 5000, fps: 30 });
    const { session } = fakeSession();
    const signal = { aborted: false };
    const run = runVideoExport({ plan, session, fileName: 'x.webm', signal, renderFrame: () => {}, onPhase: (p) => p === 'encoding' && (signal.aborted = true) });
    await expect(run).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('encoder errors cancel the session; an empty file is an error', async () => {
    const plan = planVideoFrames({ durationMs: 5000, fps: 30 });
    const broken = fakeSession({ failAt: 3 });
    await expect(runVideoExport({ plan, session: broken.session, fileName: 'x', renderFrame: () => {} })).rejects.toThrow('encoder broke');
    expect(broken.log).toEqual(['cancel']);
    const empty = fakeSession({ empty: true });
    await expect(runVideoExport({ plan, session: empty.session, fileName: 'x', renderFrame: () => {} })).rejects.toMatchObject({ code: 'encoding-failed' });
  });
});
