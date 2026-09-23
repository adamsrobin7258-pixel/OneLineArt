import { describe, expect, it } from 'vitest';
import { createTimeline, toSvgPathData } from '../../src/core';
import { pathFrom } from '../helpers';

// Segment lengths 10 and 30 -> total 40.
const path = pathFrom([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }]);

describe('animation timeline', () => {
  it('derives frame count from duration and fps', () => {
    expect(createTimeline(path, { durationMs: 2000, fps: 30, pacing: 'constant-speed' }).frameCount).toBe(60);
  });

  it('starts at the first point and ends at the full path', () => {
    const t = createTimeline(path, { durationMs: 1000, fps: 10, pacing: 'constant-speed' });
    expect(t.cursorAtFrame(0)).toEqual({ index: 1, tip: null });
    expect(t.cursorAtFrame(t.frameCount - 1)).toEqual({ index: 3, tip: null });
  });

  it('last frame renders identically to the final artwork', () => {
    const t = createTimeline(path, { durationMs: 1000, fps: 10, pacing: 'constant-speed' });
    expect(toSvgPathData(path, t.cursorAtFrame(t.frameCount - 1))).toBe(toSvgPathData(path));
  });

  it('moves at constant speed along the real points', () => {
    const t = createTimeline(path, { durationMs: 1000, fps: 10, pacing: 'constant-speed' });
    expect(t.cursorAtProgress(0.125)).toEqual({ index: 1, tip: { x: 5, y: 0 } });
    expect(t.cursorAtProgress(0.25)).toEqual({ index: 2, tip: null });
    expect(t.cursorAtProgress(0.625)).toEqual({ index: 2, tip: { x: 10, y: 15 } });
  });

  it('supports per-point pacing', () => {
    const t = createTimeline(path, { durationMs: 1000, fps: 10, pacing: 'per-point' });
    expect(t.cursorAtProgress(0.5)).toEqual({ index: 2, tip: null });
  });

  it('never goes backwards', () => {
    const t = createTimeline(path, { durationMs: 3000, fps: 30, pacing: 'constant-speed' });
    let prev = 0;
    for (let f = 0; f < t.frameCount; f++) {
      const c = t.cursorAtFrame(f);
      const pos = c.index + (c.tip ? 0.5 : 0);
      expect(pos).toBeGreaterThanOrEqual(prev);
      prev = pos;
    }
  });
});
