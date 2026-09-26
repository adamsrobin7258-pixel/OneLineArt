import type { VariableWidthParameters } from './parameters';

/**
 * Lightness → line width.
 *
 * Lines of width w at spacing s cover the share c = w / s of the paper, so an
 * area looks as light as paper with reflectance Y = 1 − c (black ink). The
 * reproducible range is therefore c ∈ [minWidth/s, maxWidth/s].
 *
 * 'perceptual' (default): the input lightness L (CIE L*, 0…1) is mapped
 * LINEARLY in L* onto the reproducible lightness range, then converted to
 * coverage via Y(L*). Every step of lightness in the photo becomes the same
 * step of perceived lightness in the drawing — in light and in dark areas.
 * Because the eye is more sensitive to coverage changes on light paper, this
 * gives light tones a steeper width response than a linear mapping (≈ 1.5×
 * with the defaults) and dark tones a flatter one: light details are kept
 * without the darks running into solid black.
 *
 * 'linear': width linear in darkness (for comparison).
 *
 * Both are continuous and strictly monotonic (darker ⇒ thicker) and stay
 * within [minWidth, maxWidth] exactly.
 */

/** Relative luminance Y (0…1) → CIE L* (0…1). */
export function lightnessOfY(y: number): number {
  const l = y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
  return Math.min(1, Math.max(0, l / 100));
}

/** CIE L* (0…1) → relative luminance Y (0…1). */
export function yOfLightness(l: number): number {
  const L = Math.min(100, Math.max(0, l * 100));
  return L > 8 ? ((L + 16) / 116) ** 3 : (L * 27) / 24389;
}

export interface WidthTransfer {
  (lightness: number): number;
}

export function createWidthTransfer(p: Pick<VariableWidthParameters, 'spacing' | 'minWidth' | 'maxWidth' | 'curve'>): WidthTransfer {
  const { spacing: s, minWidth: lo, maxWidth: hi } = p;
  const clamp = (w: number) => Math.min(hi, Math.max(lo, w));
  if (p.curve === 'linear') return (l) => clamp(lo + (hi - lo) * (1 - Math.min(1, Math.max(0, l))));
  // Lightest and darkest lightness the line can reproduce.
  const lLight = lightnessOfY(1 - lo / s);
  const lDark = lightnessOfY(1 - hi / s);
  return (l) => {
    const target = lDark + (lLight - lDark) * Math.min(1, Math.max(0, l));
    return clamp(s * (1 - yOfLightness(target)));
  };
}
