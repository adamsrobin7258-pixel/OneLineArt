import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RENDER_SETTINGS,
  LIGHT_LINE_BELOW,
  RENDER_CONTROLS,
  RENDER_LIMITS,
  backgroundLightnessOf,
  backgroundLightnessPatch,
  createPath,
  drawArtworkBackground,
  drawArtworkLine,
  isDarkBackground,
  planArtwork,
  renderSize,
  sanitizeRenderSettings,
  type RenderSettings,
} from '../../../src/core';
import { recordingContext } from './recordingContext';

const path = createPath(
  Array.from({ length: 50 }, (_, i) => ({ x: i * 2, y: i % 2 ? 60 : 10 })),
  { width: 100, height: 75 },
  { generatorId: 'test', generatorVersion: '1', seed: 0 },
);

const settings = (patch: Partial<RenderSettings>) => sanitizeRenderSettings({ ...DEFAULT_RENDER_SETTINGS, ...patch }).value;

function drawOps(s: RenderSettings) {
  const size = renderSize(path.bounds, 1000);
  const plan = planArtwork({ path, settings: s, ...size, lineColors: null });
  const ctx = recordingContext();
  drawArtworkBackground(plan, ctx);
  drawArtworkLine(plan, path, ctx);
  return { plan, ops: ctx.ops };
}

describe('render controls', () => {
  it('ranges lie inside the renderer safety limits', () => {
    expect(RENDER_CONTROLS.lineWidth.min).toBeGreaterThanOrEqual(RENDER_LIMITS.lineWidth.min);
    expect(RENDER_CONTROLS.lineWidth.max).toBeLessThanOrEqual(RENDER_LIMITS.lineWidth.max);
    expect(RENDER_CONTROLS.drawingStrength.max).toBeLessThanOrEqual(RENDER_LIMITS.lineOpacity.max);
    expect(RENDER_CONTROLS.colorIntensity.max).toBeLessThanOrEqual(RENDER_LIMITS.strength.max);
    for (const range of Object.values(RENDER_CONTROLS)) expect(range.max).toBeGreaterThan(range.min);
  });

  it('full background lightness is exactly the default white background', () => {
    expect(settings(backgroundLightnessPatch(1))).toEqual(DEFAULT_RENDER_SETTINGS);
    expect(backgroundLightnessOf(DEFAULT_RENDER_SETTINGS)).toBe(1);
  });

  it('background lightness round-trips and turns the monochrome line light on dark paper', () => {
    for (let l = 0; l <= 1.0001; l += RENDER_CONTROLS.backgroundLightness.step) {
      const value = Math.round(l * 100) / 100;
      const s = settings(backgroundLightnessPatch(value));
      expect(backgroundLightnessOf(s), String(value)).toBeCloseTo(value, 2);
      const dark = value < LIGHT_LINE_BELOW;
      expect(isDarkBackground(s), String(value)).toBe(dark);
      expect(s.lineColor, String(value)).toBe(dark ? '#ffffff' : '#000000');
    }
  });

  it('line width changes only the stroke width: same geometry, same background', () => {
    const thin = drawOps(settings({ lineWidth: 0.5 }));
    const thick = drawOps(settings({ lineWidth: 3 }));
    expect(thick.plan.lineWidthPx).toBeCloseTo(thin.plan.lineWidthPx * 6);
    const geometry = (ops: typeof thin.ops) => ops.filter((o) => o.op === 'moveTo' || o.op === 'lineTo');
    expect(geometry(thick.ops)).toEqual(geometry(thin.ops));
    expect(thick.plan.background).toEqual(thin.plan.background);
  });

  it('drawing strength is the line opacity; the plan applies it once', () => {
    expect(drawOps(settings({ lineOpacity: 0.4 })).plan.lineOpacity).toBe(0.4);
  });
});
