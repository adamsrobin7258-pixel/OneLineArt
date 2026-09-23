import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RENDER_SETTINGS,
  RENDER_LIMITS,
  RenderError,
  isDarkBackground,
  linearToOklab,
  oklabToLinear,
  parseHexColor,
  sanitizeRenderSettings,
  toHexColor,
} from '../../../src/core';

describe('render settings', () => {
  it('defaults: black line, white background, full opacity, monochrome', () => {
    expect(DEFAULT_RENDER_SETTINGS).toMatchObject({ colorMode: 'monochrome', lineColor: '#000000', background: 'white', lineOpacity: 1 });
    expect(sanitizeRenderSettings().issues).toEqual([]);
  });

  it('accept any valid line colour', () => {
    expect(sanitizeRenderSettings({ lineColor: '#C0FFEE' }).value.lineColor).toBe('#c0ffee');
    expect(sanitizeRenderSettings({ lineColor: '#abc' }).value.lineColor).toBe('#abc');
  });

  it('reject non-finite numbers with a controlled error', () => {
    for (const bad of [NaN, Infinity]) {
      expect(() => sanitizeRenderSettings({ lineWidth: bad })).toThrow(RenderError);
      expect(() => sanitizeRenderSettings({ lineOpacity: bad })).toThrow(RenderError);
    }
  });

  it('clamp out-of-range values and report them', () => {
    const { value, issues } = sanitizeRenderSettings({ lineWidth: 500, lineOpacity: -1 });
    expect(value.lineWidth).toBe(RENDER_LIMITS.lineWidth.max);
    expect(value.lineOpacity).toBe(0);
    expect(issues).toHaveLength(2);
  });

  it('fall back for invalid colours, unknown or prepared-only modes', () => {
    const { value, issues } = sanitizeRenderSettings({
      lineColor: 'red',
      // 'gradient' became available in phase 12.2; 'custom-color' stays prepared-only.
      colorMode: 'custom-color',
      background: 'marble' as never,
    });
    expect(value.lineColor).toBe('#000000');
    expect(value.colorMode).toBe('monochrome');
    expect(value.background).toBe('white');
    expect(issues.map((i) => i.name)).toEqual(['colorMode', 'lineColor', 'background']);
    expect(sanitizeRenderSettings({ colorMode: 'marble' as never }).value.colorMode).toBe('monochrome');
    expect(sanitizeRenderSettings({ colorMode: 'gradient' }).value.colorMode).toBe('gradient');
  });

  it('fix an inverted lightness range', () => {
    const { value } = sanitizeRenderSettings({ sampling: { ...DEFAULT_RENDER_SETTINGS.sampling, lightLightness: { min: 0.8, max: 0.3 } } });
    expect(value.sampling.lightLightness).toEqual({ min: 0.3, max: 0.8 });
  });

  it('know which backgrounds are dark', () => {
    expect(isDarkBackground(DEFAULT_RENDER_SETTINGS)).toBe(false);
    expect(isDarkBackground({ ...DEFAULT_RENDER_SETTINGS, background: 'black' })).toBe(true);
    expect(isDarkBackground({ ...DEFAULT_RENDER_SETTINGS, background: 'custom', backgroundColor: '#102030' })).toBe(true);
    expect(isDarkBackground({ ...DEFAULT_RENDER_SETTINGS, background: 'custom', backgroundColor: '#f5f0e0' })).toBe(false);
  });
});

describe('colour space', () => {
  it('OKLab round-trips', () => {
    for (const [r, g, b] of [[0.2, 0.5, 0.9], [1, 0, 0], [0, 0, 0], [1, 1, 1]] as const) {
      const [L, a, bb] = linearToOklab(r, g, b);
      const back = oklabToLinear(L, a, bb);
      expect(back[0]).toBeCloseTo(r, 5);
      expect(back[1]).toBeCloseTo(g, 5);
      expect(back[2]).toBeCloseTo(b, 5);
    }
    expect(linearToOklab(1, 1, 1)[0]).toBeCloseTo(1, 4);
  });

  it('parses and formats hex colours', () => {
    expect(parseHexColor('#ff8000')).toEqual([255, 128, 0]);
    expect(parseHexColor('#f80')).toEqual([255, 136, 0]);
    expect(toHexColor([255, 128, 0])).toBe('#ff8000');
  });
});
