import type { RenderSettings } from './renderSettings';

/**
 * The creative render controls offered in the UI and their ranges. They only
 * change how the SAME path is drawn (never the path itself):
 * - lineWidth:           RenderSettings.lineWidth (px at the reference edge)
 * - drawingStrength:     RenderSettings.lineOpacity (how strongly the line marks the paper)
 * - backgroundLightness: plain background from black (0) to white (1)
 * - colorIntensity:      RenderSettings.sampling.strength (colour mode only)
 */
export const RENDER_CONTROLS = {
  lineWidth: { min: 0.25, max: 4, step: 0.05 },
  drawingStrength: { min: 0.2, max: 1, step: 0.05 },
  backgroundLightness: { min: 0, max: 1, step: 0.05 },
  colorIntensity: { min: 0, max: 1.5, step: 0.05 },
} as const;

/** Below this background lightness a monochrome line is drawn light (stays visible). */
export const LIGHT_LINE_BELOW = 0.4;

const LINE_ON_LIGHT = '#000000';
const LINE_ON_DARK = '#ffffff';

const hexByte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');

/** Lightness of a plain background (white 1, black 0, custom grey by its level); photo/transparent count as light. */
export function backgroundLightnessOf(settings: RenderSettings): number {
  if (settings.background === 'black') return 0;
  if (settings.background !== 'custom') return 1;
  const hex = settings.backgroundColor.slice(1);
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  return Math.round((0.2126 * r! + 0.7152 * g! + 0.0722 * b!) * 100) / 100;
}

/**
 * Render-settings patch for a plain background of `lightness` (0..1). Full
 * lightness is exactly the default white background. The monochrome line
 * switches to white on dark backgrounds so it stays visible; the colour mode
 * adapts its lightness range on its own (isDarkBackground).
 */
export function backgroundLightnessPatch(lightness: number): Pick<RenderSettings, 'background' | 'backgroundColor' | 'lineColor'> {
  const l = Math.min(1, Math.max(0, lightness));
  if (l >= 1) return { background: 'white', backgroundColor: '#ffffff', lineColor: LINE_ON_LIGHT };
  const grey = hexByte(l);
  return { background: 'custom', backgroundColor: `#${grey}${grey}${grey}`, lineColor: l < LIGHT_LINE_BELOW ? LINE_ON_DARK : LINE_ON_LIGHT };
}
