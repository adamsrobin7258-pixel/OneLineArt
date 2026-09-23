import type { OneLinePath } from '../models';
import type { LineColors } from './colorSampling';
import { SRGB_TO_LINEAR, linearToOklab, linearToSrgb8, oklabToLinear, parseHexColor, toHexColor } from './colorSpace';

/** A few prepared, clearly distinct palettes (dark enough to read on white paper). */
export interface ColorPalette {
  readonly id: string;
  readonly label: string;
  readonly colors: readonly string[];
}

export const COLOR_PALETTES: readonly ColorPalette[] = [
  { id: 'sunset', label: 'Abendrot', colors: ['#f4a259', '#e4572e', '#a4243b', '#3d1e6d'] },
  { id: 'ocean', label: 'Ozean', colors: ['#0b3954', '#087e8b', '#2a9d8f', '#76c7b7'] },
  { id: 'forest', label: 'Wald', colors: ['#1b4332', '#40916c', '#95a53c', '#d4a373'] },
  { id: 'berry', label: 'Beere', colors: ['#3c096c', '#7b2cbf', '#c9184a', '#ff758f'] },
  { id: 'ember', label: 'Glut', colors: ['#03071e', '#6a040f', '#d00000', '#f48c06'] },
];

/** Gradient length limits (start + end, up to a palette's stops). */
export const GRADIENT_STOPS = { min: 2, max: 6 } as const;

/** Palette whose colours are exactly `colors`, if any. */
export function paletteOf(colors: readonly string[]): ColorPalette | null {
  const key = colors.map((c) => c.toLowerCase()).join(',');
  return COLOR_PALETTES.find((p) => p.colors.join(',') === key) ?? null;
}

const toLab = (hex: string): [number, number, number] => {
  const [r, g, b] = parseHexColor(hex);
  return linearToOklab(SRGB_TO_LINEAR[r]!, SRGB_TO_LINEAR[g]!, SRGB_TO_LINEAR[b]!);
};

const fromLab = (L: number, a: number, b: number): [number, number, number] => {
  const [r, g, bl] = oklabToLinear(L, a, b);
  return [linearToSrgb8(r), linearToSrgb8(g), linearToSrgb8(bl)];
};

/**
 * Colour intensity (the ONE "Farbintensität" setting, 0..1.5) applied to a
 * chosen colour: scales its OKLab chroma, lightness stays. 1 = the colour as
 * chosen (returned unchanged), 0 = neutral grey of the same lightness.
 */
export function applyColorIntensity(hex: string, strength: number): string {
  if (strength === 1) return hex;
  const [L, a, b] = toLab(hex);
  return toHexColor(fromLab(L, a * strength, b * strength));
}

/**
 * Gradient along the drawing: every vertex gets the colour at its share of
 * the path's arc length, interpolated in OKLab between evenly spaced stops
 * (start → … → end). Pure colour data next to the unchanged OneLinePath —
 * the same LineColors the photo colours use, drawn by the same renderer.
 */
export function gradientLineColors(path: OneLinePath, colors: readonly string[], strength: number): LineColors {
  const c = path.coords;
  const n = c.length >> 1;
  const stops = colors.map(toLab);
  const arc = new Float64Array(n);
  for (let i = 1; i < n; i++) arc[i] = arc[i - 1]! + Math.hypot(c[i * 2]! - c[i * 2 - 2]!, c[i * 2 + 1]! - c[i * 2 - 1]!);
  const total = n ? arc[n - 1]! : 0;
  const rgb = new Uint8ClampedArray(n * 3);
  const segments = stops.length - 1;
  for (let i = 0; i < n; i++) {
    const t = total > 0 ? arc[i]! / total : 0;
    const k = Math.min(segments - 1, Math.floor(t * segments));
    const f = t * segments - k;
    const s0 = stops[k]!, s1 = stops[k + 1]!;
    const [r, g, b] = fromLab(s0[0] + (s1[0] - s0[0]) * f, (s0[1] + (s1[1] - s0[1]) * f) * strength, (s0[2] + (s1[2] - s0[2]) * f) * strength);
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
  }
  return { rgb, vertexCount: n, stations: n, stationSpacingPx: n > 1 ? total / (n - 1) : 0, sampleRadiusPx: 0, smoothingPx: 0 };
}

/** Luma (0..1) of an sRGB colour, on gamma values (the scale of the background slider). */
export function lumaOf(hex: string): number {
  const [r, g, b] = parseHexColor(hex);
  // Rounded so that greys give exactly their level (the weights sum to 1).
  return Math.round(((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255) * 1e9) / 1e9;
}

/**
 * Background colour for a base colour at a lightness (luma 0..1): darker by
 * scaling towards black, lighter by mixing towards white; the hue is kept.
 * For white as base this is exactly the grey of the lightness.
 */
export function colorAtLightness(base: string, lightness: number): string {
  const l = Math.min(1, Math.max(0, lightness));
  const rgb = parseHexColor(base);
  const current = lumaOf(base);
  if (l <= current) {
    const k = current > 0 ? l / current : 0;
    return toHexColor(rgb.map((v) => Math.round(v * k)) as unknown as [number, number, number]);
  }
  const t = current < 1 ? (l - current) / (1 - current) : 0;
  return toHexColor(rgb.map((v) => Math.round(v + (255 - v) * t)) as unknown as [number, number, number]);
}
