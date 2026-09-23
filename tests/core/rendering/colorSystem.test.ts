import { describe, expect, it } from 'vitest';
import {
  COLOR_PALETTES,
  DEFAULT_RENDER_SETTINGS,
  applyColorIntensity,
  backgroundColorPatch,
  backgroundLightnessOf,
  backgroundLightnessPatch,
  colorAtLightness,
  createPath,
  drawArtworkBackground,
  drawArtworkLine,
  gradientLineColors,
  isDarkBackground,
  lumaOf,
  paletteOf,
  parseHexColor,
  planArtwork,
  renderSize,
  sanitizeRenderSettings,
  usesLineColors,
  type RenderSettings,
} from '../../../src/core';
import { recordingContext } from './recordingContext';

const path = createPath(
  Array.from({ length: 101 }, (_, i) => ({ x: i, y: i % 2 ? 60 : 10 })),
  { width: 100, height: 75 },
  { generatorId: 'test', generatorVersion: '1', seed: 0 },
);
const settings = (patch: Partial<RenderSettings>) => sanitizeRenderSettings({ ...DEFAULT_RENDER_SETTINGS, ...patch }).value;
const vertex = (rgb: Uint8ClampedArray, i: number) => [rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!];

function plan(s: RenderSettings) {
  const size = renderSize(path.bounds, 1000);
  const lineColors = s.colorMode === 'gradient' ? gradientLineColors(path, s.gradient.colors, s.sampling.strength) : null;
  const p = planArtwork({ path, settings: s, ...size, lineColors });
  const ctx = recordingContext();
  drawArtworkBackground(p, ctx);
  drawArtworkLine(p, path, ctx);
  return { plan: p, ops: ctx.ops };
}

describe('colour system', () => {
  it('older settings (no gradient / background base) get defaults without issues', () => {
    const legacy = { ...DEFAULT_RENDER_SETTINGS } as Partial<RenderSettings>;
    delete (legacy as { gradient?: unknown }).gradient;
    delete (legacy as { backgroundBase?: unknown }).backgroundBase;
    const { value, issues } = sanitizeRenderSettings({ ...legacy, background: 'custom', backgroundColor: '#595959' });
    expect(issues).toEqual([]);
    expect(value.backgroundBase).toBe('#ffffff');
    expect(value.gradient).toEqual(DEFAULT_RENDER_SETTINGS.gradient);
    // Their background slider position is unchanged (0.35 in phase 12.1).
    expect(backgroundLightnessOf(value)).toBeCloseTo(0.35, 2);
  });

  it('invalid gradients fall back (reported)', () => {
    for (const colors of [['#fff'], ['#fff', 'red'], Array(7).fill('#000000')]) {
      const { value, issues } = sanitizeRenderSettings({ gradient: { colors } });
      expect(value.gradient).toEqual(DEFAULT_RENDER_SETTINGS.gradient);
      expect(issues.map((i) => i.name)).toEqual(['gradient']);
    }
  });

  it('palettes: a few distinct multi-colour palettes, all valid gradients', () => {
    expect(COLOR_PALETTES.length).toBeGreaterThanOrEqual(4);
    expect(COLOR_PALETTES.length).toBeLessThanOrEqual(6);
    expect(new Set(COLOR_PALETTES.map((p) => p.id)).size).toBe(COLOR_PALETTES.length);
    for (const p of COLOR_PALETTES) {
      expect(p.colors.length).toBeGreaterThanOrEqual(3);
      expect(sanitizeRenderSettings({ gradient: { colors: p.colors } }).issues).toEqual([]);
      expect(paletteOf(p.colors)).toBe(p);
    }
    expect(paletteOf(['#000000', '#ffffff'])).toBeNull();
  });

  it('gradient: start colour at the start, end colour at the end, along the arc length', () => {
    const colors = gradientLineColors(path, ['#ff0000', '#0000ff'], 1);
    expect(colors.vertexCount).toBe(101);
    expect(vertex(colors.rgb, 0)).toEqual([255, 0, 0]);
    expect(vertex(colors.rgb, 100)).toEqual([0, 0, 255]);
    const mid = vertex(colors.rgb, 50);
    expect(mid[0]).toBeGreaterThan(30);
    expect(mid[2]).toBeGreaterThan(30);
    // Deterministic, and the path is untouched.
    const before = path.coords.slice();
    expect(gradientLineColors(path, ['#ff0000', '#0000ff'], 1).rgb).toEqual(colors.rgb);
    expect(path.coords).toEqual(before);
  });

  it('gradient with a palette: every stop is reached in order', () => {
    const p = COLOR_PALETTES[1]!;
    const colors = gradientLineColors(path, p.colors, 1);
    expect(vertex(colors.rgb, 0)).toEqual([...parseHexColor(p.colors[0]!)]);
    expect(vertex(colors.rgb, 100)).toEqual([...parseHexColor(p.colors[p.colors.length - 1]!)]);
  });

  it('gradient is drawn in colour runs by the same renderer', () => {
    const s = settings({ colorMode: 'gradient' });
    expect(usesLineColors(s)).toBe(true);
    const { plan: p } = plan(s);
    expect(p.stroke.kind).toBe('runs');
    expect(p.stroke.kind === 'runs' && p.stroke.colors.length).toBeGreaterThan(5);
    expect(() => planArtwork({ path, settings: s, ...renderSize(path.bounds, 1000), lineColors: null })).toThrow();
  });

  it('custom line colour: a single solid colour; black stays exactly the old default', () => {
    expect(plan(settings({ lineColor: '#b3261e' })).plan.stroke).toEqual({ kind: 'solid', color: '#b3261e' });
    expect(plan(DEFAULT_RENDER_SETTINGS).plan.stroke).toEqual({ kind: 'solid', color: '#000000' });
  });

  it('colour intensity is ONE setting for all modes: 1 = as chosen, 0 = grey, more = stronger', () => {
    expect(applyColorIntensity('#b3261e', 1)).toBe('#b3261e');
    const [r, g, b] = parseHexColor(applyColorIntensity('#b3261e', 0));
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(2);
    expect(applyColorIntensity('#000000', 0.3)).toBe('#000000');
    const chroma = (hex: string) => {
      const c = parseHexColor(hex);
      return Math.max(...c) - Math.min(...c);
    };
    expect(chroma(applyColorIntensity('#b35a4e', 1.5))).toBeGreaterThan(chroma('#b35a4e'));
    // Same setting drives the solid colour and the gradient.
    const grey = plan(settings({ lineColor: '#b3261e', sampling: { ...DEFAULT_RENDER_SETTINGS.sampling, strength: 0 } })).plan.stroke;
    expect(grey.kind === 'solid' && chroma(grey.color)).toBeLessThanOrEqual(2);
    const flat = gradientLineColors(path, ['#ff0000', '#0000ff'], 0);
    const v = vertex(flat.rgb, 0);
    expect(Math.max(...v) - Math.min(...v)).toBeLessThanOrEqual(2);
  });

  it('works together with line width and drawing strength', () => {
    const { plan: p, ops } = plan(settings({ colorMode: 'gradient', lineWidth: 3, lineOpacity: 0.5 }));
    expect(p.lineWidthPx).toBeCloseTo(3);
    expect(p.lineOpacity).toBe(0.5);
    const thin = plan(settings({ colorMode: 'gradient' }));
    const geometry = (list: typeof ops) => list.filter((o) => o.op === 'moveTo' || o.op === 'lineTo');
    expect(geometry(ops)).toEqual(geometry(thin.ops));
  });
});

describe('background colour and lightness', () => {
  it('white base: exactly the greys of phase 12.1', () => {
    for (let l = 0; l <= 1.0001; l += 0.05) {
      const grey = Math.round(Math.min(1, l) * 255).toString(16).padStart(2, '0');
      expect(colorAtLightness('#ffffff', l)).toBe(`#${grey}${grey}${grey}`);
    }
    expect(settings(backgroundLightnessPatch(1))).toEqual(DEFAULT_RENDER_SETTINGS);
  });

  it('white, black and an own colour; lightness then works on the chosen colour', () => {
    const d = DEFAULT_RENDER_SETTINGS;
    expect(settings(backgroundColorPatch('#ffffff', d))).toEqual(d);
    const black = settings(backgroundColorPatch('#000000', d));
    expect(black).toMatchObject({ background: 'custom', backgroundColor: '#000000', backgroundBase: '#000000', lineColor: '#ffffff' });
    expect(isDarkBackground(black)).toBe(true);
    const cream = settings(backgroundColorPatch('#f3e9d2', d));
    expect(cream).toMatchObject({ backgroundColor: '#f3e9d2', backgroundBase: '#f3e9d2', lineColor: '#000000' });
    expect(backgroundLightnessOf(cream)).toBeCloseTo(lumaOf('#f3e9d2'), 2);
    // Darker cream keeps its hue (red ≥ green ≥ blue) …
    const darker = settings(backgroundLightnessPatch(0.3, cream));
    const [r, g, b] = parseHexColor(darker.backgroundColor);
    expect(r).toBeGreaterThanOrEqual(g);
    expect(g).toBeGreaterThanOrEqual(b);
    expect(backgroundLightnessOf(darker)).toBeCloseTo(0.3, 1);
    // … and the base stays, so going back up returns to the chosen colour.
    expect(settings(backgroundLightnessPatch(backgroundLightnessOf(cream), darker)).backgroundColor).toBe('#f3e9d2');
  });

  it('a picked line colour is kept on dark paper; black/white lines switch automatically', () => {
    const red = settings({ lineColor: '#b3261e' });
    expect(backgroundLightnessPatch(0.1, red).lineColor).toBe('#b3261e');
    expect(backgroundLightnessPatch(0.1, DEFAULT_RENDER_SETTINGS).lineColor).toBe('#ffffff');
    expect(backgroundLightnessPatch(0.9, settings({ lineColor: '#ffffff' })).lineColor).toBe('#000000');
  });
});
