import type { ScalarField } from '../models';

export type DebugColormap = 'grayscale' | 'heatmap';

/** Inferno-like ramp: dark = low, bright = high. Perceptually ordered for debugging. */
const HEAT_STOPS: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 0, 4],
  [0.25, 87, 16, 110],
  [0.5, 188, 55, 84],
  [0.75, 249, 142, 9],
  [1, 252, 255, 164],
];

function heat(v: number): [number, number, number] {
  for (let s = 1; s < HEAT_STOPS.length; s++) {
    const [t1, r1, g1, b1] = HEAT_STOPS[s]!;
    if (v <= t1) {
      const [t0, r0, g0, b0] = HEAT_STOPS[s - 1]!;
      const f = (v - t0) / (t1 - t0);
      return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f];
    }
  }
  return [252, 255, 164];
}

/**
 * RGBA visualization of a [0,1] field for developer inspection only.
 * The analysis itself stays numeric; this is a lossy view.
 */
export function fieldToRgba(field: ScalarField, colormap: DebugColormap = 'grayscale'): Uint8ClampedArray {
  const out = new Uint8ClampedArray(field.data.length * 4);
  for (let i = 0; i < field.data.length; i++) {
    const v = Math.min(1, Math.max(0, field.data[i]!));
    const [r, g, b] = colormap === 'heatmap' ? heat(v) : [v * 255, v * 255, v * 255];
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}
