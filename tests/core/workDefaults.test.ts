import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ANIMATION_SETTINGS,
  DEFAULT_DRAWING_SETTINGS,
  DEFAULT_RENDER_SETTINGS,
  FACTORY_WORK_DEFAULTS,
  animationForNewWork,
  drawingForNewWork,
  parseWorkDefaults,
  renderForNewWork,
  resolveOneLineSettings,
} from '../../src/core';

describe('13.8 defaults for new works', () => {
  it('factory defaults are exactly what a new work got before 13.8', () => {
    expect(drawingForNewWork(FACTORY_WORK_DEFAULTS)).toEqual(DEFAULT_DRAWING_SETTINGS);
    expect(resolveOneLineSettings(drawingForNewWork(FACTORY_WORK_DEFAULTS)).key).toBe(resolveOneLineSettings().key);
    expect(renderForNewWork(FACTORY_WORK_DEFAULTS)).toEqual(DEFAULT_RENDER_SETTINGS);
    expect(animationForNewWork(FACTORY_WORK_DEFAULTS)).toEqual({ durationMs: DEFAULT_ANIMATION_SETTINGS.durationMs, speed: 1, direction: 'forward', startPoint: null, loop: false });
  });

  it('chosen defaults shape a new work: style, detail, background, line width, animation', () => {
    const d = parseWorkDefaults({ style: 'orthogonal', detailLevel: 'detail', background: 'black', lineWidth: 2.5, durationMs: 15_000, speed: 2, direction: 'reverse', loop: true });
    expect(resolveOneLineSettings(drawingForNewWork(d)).drawing).toMatchObject({ style: 'orthogonal', detailLevel: 'detail' });
    const render = renderForNewWork(d);
    expect(render).toMatchObject({ lineWidth: 2.5, backgroundBase: '#000000', colorMode: DEFAULT_RENDER_SETTINGS.colorMode });
    // A black background gets a light line (the existing rule of the background control).
    expect(render.lineColor).toBe('#ffffff');
    expect(animationForNewWork(d)).toEqual({ durationMs: 15_000, speed: 2, direction: 'reverse', startPoint: null, loop: true });
  });

  it('stored values are read back safely: unknown → default, out of range → clamped, never an error', () => {
    expect(parseWorkDefaults(null)).toEqual(FACTORY_WORK_DEFAULTS);
    expect(parseWorkDefaults('kaputt')).toEqual(FACTORY_WORK_DEFAULTS);
    expect(parseWorkDefaults([1, 2])).toEqual(FACTORY_WORK_DEFAULTS);
    const odd = parseWorkDefaults({ style: 'cubist', detailLevel: 'ultra', background: 'pink', lineWidth: 99, durationMs: 1, speed: 3, direction: 'up', loop: 'yes' });
    expect(odd).toEqual({ ...FACTORY_WORK_DEFAULTS, lineWidth: 4, durationMs: 2_000 });
    expect(parseWorkDefaults({ lineWidth: 1.2 }).lineWidth).toBe(1.2);
    expect(parseWorkDefaults({ lineWidth: 1.23 }).lineWidth).toBe(1.25);
    expect(parseWorkDefaults({ durationMs: 12_345 }).durationMs).toBe(12_500);
    expect(parseWorkDefaults({ durationMs: 30_000 }).durationMs).toBe(30_000);
    expect(parseWorkDefaults({ lineWidth: Number.NaN }).lineWidth).toBe(FACTORY_WORK_DEFAULTS.lineWidth);
  });

  it('never carries a start point: it belongs to one image', () => {
    expect(animationForNewWork(parseWorkDefaults({ loop: true })).startPoint).toBeNull();
  });
});
