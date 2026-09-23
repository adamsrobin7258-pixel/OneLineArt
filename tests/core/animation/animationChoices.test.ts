import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ANIMATION_SETTINGS,
  DURATION_PRESETS_MS,
  DURATION_RANGE_MS,
  FINAL_HOLD_MS,
  SPEED_PRESETS,
  VIDEO_DRAWING_RANGE_MS,
  clampDurationMs,
  drawingDurationMs,
  isPresetDuration,
  planVideoFrames,
  sanitizeAnimationSettings,
  sanitizeVideoExportSettings,
} from '../../../src/core';

describe('animation choices', () => {
  it('presets stay; own durations are custom values on a 0.5 s grid within 2…60 s', () => {
    expect(DURATION_PRESETS_MS).toEqual([5_000, 10_000, 15_000, 30_000]);
    for (const ms of DURATION_PRESETS_MS) expect(isPresetDuration(ms)).toBe(true);
    expect(isPresetDuration(7_500)).toBe(false);
    expect(clampDurationMs(7_500)).toBe(7_500);
    expect(clampDurationMs(12_240)).toBe(12_000);
    expect(clampDurationMs(100)).toBe(DURATION_RANGE_MS.min);
    expect(clampDurationMs(10_000_000)).toBe(DURATION_RANGE_MS.max);
    expect(() => clampDurationMs(Number.NaN)).toThrow();
  });

  it('speed is a factor on the drawing time; time-based, no frame rate involved', () => {
    expect(drawingDurationMs({ durationMs: 10_000 })).toBe(10_000);
    expect(drawingDurationMs({ durationMs: 10_000, speed: 2 })).toBe(5_000);
    expect(drawingDurationMs({ durationMs: 10_000, speed: 0.5 })).toBe(20_000);
    // Every combination offered is a valid video drawing time.
    for (const speed of SPEED_PRESETS) {
      for (const ms of [DURATION_RANGE_MS.min, DURATION_RANGE_MS.max]) {
        const draw = drawingDurationMs({ durationMs: ms, speed });
        expect(draw).toBeGreaterThanOrEqual(VIDEO_DRAWING_RANGE_MS.min);
        expect(draw).toBeLessThanOrEqual(VIDEO_DRAWING_RANGE_MS.max);
        expect(sanitizeVideoExportSettings({ durationMs: draw }).durationMs).toBe(draw);
      }
    }
  });

  it('older settings get defaults: speed 1, forward, the path start', () => {
    const { value, issues } = sanitizeAnimationSettings({ durationMs: 15_000, fps: 30, pacing: 'constant-speed' });
    expect(value).toMatchObject({ durationMs: 15_000, speed: 1, direction: 'forward', startPoint: null });
    expect(issues).toEqual([]);
    expect(DEFAULT_ANIMATION_SETTINGS).toMatchObject({ speed: 1, direction: 'forward', startPoint: null });
  });

  it('validates direction and start point', () => {
    expect(sanitizeAnimationSettings({ direction: 'sideways' as never }).value.direction).toBe('forward');
    const clamped = sanitizeAnimationSettings({ startPoint: { x: 1.5, y: -0.1 } });
    expect(clamped.value.startPoint).toEqual({ x: 1, y: 0 });
    expect(clamped.issues.map((i) => i.name)).toEqual(['startPoint']);
    expect(() => sanitizeAnimationSettings({ startPoint: { x: Number.NaN, y: 0 } })).toThrow();
    expect(sanitizeAnimationSettings({ startPoint: { x: 0.3, y: 0.7 }, direction: 'reverse', speed: 2 }).value).toMatchObject({
      startPoint: { x: 0.3, y: 0.7 },
      direction: 'reverse',
      speed: 2,
    });
  });

  it('video: an own duration is drawn in exactly that time, then the 2 s hold', () => {
    const plan = planVideoFrames({ fps: 30, durationMs: 7_500 });
    expect(plan.drawDurationMs).toBe(7_500);
    expect(plan.holdMs).toBe(FINAL_HOLD_MS);
    expect(plan.durationMs).toBe(9_500);
    expect(plan.frameCount).toBe(9.5 * 30 + 1);
    // The drawing is complete exactly at 7.5 s (frame 225), never earlier.
    expect(plan.progress[224]).toBeLessThan(1);
    expect(plan.progress[225]).toBe(1);
    expect(plan.progress.slice(225).every((p) => p === 1)).toBe(true);
    expect(plan.progress[75]).toBeCloseTo(1 / 3);
  });
});
