import { colorAtLightness, lumaOf } from './lineColoring';
import { isDarkBackground, type RenderSettings } from './renderSettings';

/**
 * The creative render controls offered in the UI and their ranges. They only
 * change how the SAME path is drawn (never the path itself):
 * - lineWidth:           RenderSettings.lineWidth (px at the reference edge)
 * - drawingStrength:     RenderSettings.lineOpacity (how strongly the line marks the paper)
 * - backgroundLightness: plain background from black (0) to white (1)
 * - colorIntensity:      RenderSettings.sampling.strength — chroma of every line colour
 *                        (photo colours, gradient, chosen single colour)
 */
export const RENDER_CONTROLS = {
  lineWidth: { min: 0.25, max: 4, step: 0.05 },
  drawingStrength: { min: 0.2, max: 1, step: 0.05 },
  backgroundLightness: { min: 0, max: 1, step: 0.05 },
  colorIntensity: { min: 0, max: 1.5, step: 0.05 },
} as const;

/** Below this background lightness a monochrome line is drawn light (stays visible; = isDarkBackground). */
export const LIGHT_LINE_BELOW = 0.4;

const LINE_ON_LIGHT = '#000000';
const LINE_ON_DARK = '#ffffff';

/** Lightness of a plain background (white 1, black 0, custom colour by its luma); photo/transparent count as light. */
export function backgroundLightnessOf(settings: RenderSettings): number {
  if (settings.background === 'black') return 0;
  if (settings.background !== 'custom') return 1;
  return lumaOf(settings.backgroundColor);
}

const isAutoLineColor = (color: string) => color === LINE_ON_LIGHT || color === LINE_ON_DARK;

/**
 * Render-settings patch for the background at `lightness` (0..1), applied to
 * the chosen background colour (`current.backgroundBase`; white by default).
 * White at full lightness is exactly the default white background. A black or
 * white monochrome line switches between black and white so it stays visible;
 * a colour the user picked is kept. The colour mode adapts its lightness range
 * on its own (isDarkBackground).
 */
export function backgroundLightnessPatch(
  lightness: number,
  current?: Pick<RenderSettings, 'backgroundBase' | 'lineColor'>,
): Pick<RenderSettings, 'background' | 'backgroundColor' | 'backgroundBase' | 'lineColor'> {
  const base = current?.backgroundBase ?? '#ffffff';
  const color = colorAtLightness(base, lightness);
  // Same dark/light decision as the renderer's colour mode (isDarkBackground).
  const dark = isDarkBackground({ background: 'custom', backgroundColor: color } as RenderSettings);
  const lineColor = current && !isAutoLineColor(current.lineColor) ? current.lineColor : dark ? LINE_ON_DARK : LINE_ON_LIGHT;
  if (color === '#ffffff') return { background: 'white', backgroundColor: '#ffffff', backgroundBase: base, lineColor };
  return { background: 'custom', backgroundColor: color, backgroundBase: base, lineColor };
}

/** Patch for a newly chosen background colour (its own lightness; the slider then works on it). */
export function backgroundColorPatch(
  color: string,
  current: Pick<RenderSettings, 'lineColor'>,
): Pick<RenderSettings, 'background' | 'backgroundColor' | 'backgroundBase' | 'lineColor'> {
  const base = color.toLowerCase();
  return backgroundLightnessPatch(lumaOf(base), { backgroundBase: base, lineColor: current.lineColor });
}
