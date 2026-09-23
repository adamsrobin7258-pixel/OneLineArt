import { describe, expect, it } from 'vitest';
import {
  AnimationError,
  DEFAULT_ANIMATION_SETTINGS,
  DURATION_PRESETS_MS,
  SPEED_PRESETS,
  createPlayback,
  elapsedMs,
  frameTimesMs,
  pause,
  play,
  progressAtTime,
  replay,
  sanitizeAnimationSettings,
  seek,
  setSpeed,
  tick,
} from '../../../src/core';

describe('animation settings', () => {
  it('defaults: 10 s, linear, constant speed along the path', () => {
    expect(DEFAULT_ANIMATION_SETTINGS).toMatchObject({ durationMs: 10_000, easing: 'linear', pacing: 'constant-speed' });
    expect(DURATION_PRESETS_MS).toEqual([5_000, 10_000, 15_000, 30_000]);
    expect(SPEED_PRESETS).toEqual([0.5, 1, 2, 4]);
  });

  it('validation: clamps, falls back, rejects non-finite values', () => {
    const { value, issues } = sanitizeAnimationSettings({ durationMs: 10, fps: 1000, easing: 'ease-in-out' });
    expect(value.durationMs).toBe(500);
    expect(value.fps).toBe(120);
    expect(value.easing).toBe('linear');
    expect(issues).toHaveLength(3);
    expect(() => sanitizeAnimationSettings({ durationMs: NaN })).toThrow(AnimationError);
  });

  it('time → progress is purely time-based and clamped', () => {
    expect(progressAtTime(0, DEFAULT_ANIMATION_SETTINGS)).toBe(0);
    expect(progressAtTime(2_500, DEFAULT_ANIMATION_SETTINGS)).toBe(0.25);
    expect(progressAtTime(10_000, DEFAULT_ANIMATION_SETTINGS)).toBe(1);
    expect(progressAtTime(99_000, DEFAULT_ANIMATION_SETTINGS)).toBe(1);
    expect(progressAtTime(-5, DEFAULT_ANIMATION_SETTINGS)).toBe(0);
  });

  it('video frame times cover 0 … duration, last frame complete', () => {
    const times = frameTimesMs({ ...DEFAULT_ANIMATION_SETTINGS, durationMs: 1000, fps: 30 });
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBe(1000);
    expect(times).toHaveLength(31);
  });
});

describe('playback (time-based, independent of frame rate)', () => {
  const start = createPlayback(10_000);

  it('starts at 0, plays to exactly 1 and finishes', () => {
    expect(start).toMatchObject({ status: 'ready', progress: 0 });
    let s = play(start, 1000);
    s = tick(s, 3500);
    expect(s.progress).toBeCloseTo(0.25);
    s = tick(s, 50_000);
    expect(s).toMatchObject({ status: 'finished', progress: 1 });
  });

  it('the position depends only on elapsed time, whatever the frame rate', () => {
    const at = (fps: number) => {
      let s = play(start, 0);
      for (let t = 0; t <= 4000; t += 1000 / fps) s = tick(s, t);
      return tick(s, 4000).progress;
    };
    expect(at(60)).toBeCloseTo(0.4, 12);
    expect(at(30)).toBeCloseTo(0.4, 12);
    expect(at(7)).toBeCloseTo(0.4, 12); // heavy frame drops
  });

  it('pause keeps the exact state; resume continues from there', () => {
    let s = tick(play(start, 0), 2000);
    s = pause(s, 3000);
    expect(s).toMatchObject({ status: 'paused', progress: 0.3 });
    expect(tick(s, 60_000).progress).toBe(0.3); // time passes, nothing moves
    s = play(s, 60_000);
    expect(tick(s, 61_000).progress).toBeCloseTo(0.4);
  });

  it('replay restarts at 0; play after the end starts over', () => {
    const done = tick(play(start, 0), 20_000);
    expect(replay(done, 100)).toMatchObject({ status: 'playing', progress: 0 });
    expect(play(done, 100)).toMatchObject({ status: 'playing', progress: 0 });
  });

  it('speed changes rate, not position', () => {
    let s = tick(play(start, 0), 2000); // 0.2
    s = setSpeed(s, 2, 2000);
    expect(s.progress).toBeCloseTo(0.2);
    expect(tick(s, 3000).progress).toBeCloseTo(0.4);
    expect(elapsedMs(tick(s, 3000))).toBeCloseTo(4000);
  });

  it('seek to the end shows the finished artwork', () => {
    expect(seek(start, 1, 0)).toMatchObject({ status: 'finished', progress: 1 });
    expect(seek(start, 0.5, 0)).toMatchObject({ status: 'paused', progress: 0.5 });
  });

  it('rejects non-finite clock values', () => {
    expect(() => tick(play(start, 0), NaN)).toThrow(AnimationError);
    expect(() => createPlayback(Infinity)).toThrow(AnimationError);
  });
});
