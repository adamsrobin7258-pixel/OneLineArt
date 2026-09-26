import { gaussianBlur, mapField } from '../../imageAnalysis';
import type { ScalarField } from '../../models';
import type { VariableWidthLine } from './generate';
import { lightnessOfY, yOfLightness } from './transfer';

/**
 * Measurements for the prototype and its comparison with the existing styles.
 * They DESCRIBE differences; none of them is a quality verdict.
 */

export interface SpacingMeasurement {
  /** Distinct row (or column) positions of the straight parts, image px. */
  readonly lines: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
}

/**
 * Distance between neighbouring rows of a meander, measured on the path
 * itself: the y (x for columns) of every straight axis-parallel segment.
 */
export function measureMeanderSpacing(line: VariableWidthLine): SpacingMeasurement {
  const c = line.path.coords;
  const columns = line.parameters.route === 'meander-columns';
  const positions = new Set<number>();
  for (let i = 2; i < c.length; i += 2) {
    const dx = c[i]! - c[i - 2]!, dy = c[i + 1]! - c[i - 1]!;
    const along = columns ? dy : dx, across = columns ? dx : dy;
    // Part of a row: moving along, not across (turn segments always move across).
    if (across === 0 && along !== 0) positions.add(columns ? c[i]! : c[i + 1]!);
  }
  const sorted = [...positions].sort((a, b) => a - b);
  let min = Infinity, max = 0, sum = 0;
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i]! - sorted[i - 1]!;
    min = Math.min(min, d);
    max = Math.max(max, d);
    sum += d;
  }
  return { lines: sorted.length, min: sorted.length > 1 ? min : 0, max, mean: sorted.length > 1 ? sum / (sorted.length - 1) : 0 };
}

export interface ToneBandComparison {
  /** Share of the image in this band (by original lightness). */
  readonly share: number;
  /** Mean |lightness difference| between original and drawing, both seen at viewing scale (L* 0…1). */
  readonly toneError: number;
  /** Correlation of local structure (band-pass) between original and drawing: 1 = same structure. */
  readonly detailCorrelation: number;
  /** How strongly that structure comes through (regression slope drawing ← original): 1 = full local contrast. */
  readonly detailGain: number;
}

export interface RenderingComparison {
  readonly light: ToneBandComparison;
  readonly mid: ToneBandComparison;
  readonly dark: ToneBandComparison;
  /** Share of the drawing covered by closed ink (no paper visible within a spacing). */
  readonly closedInkShare: number;
  /** Share of the drawing with no line at all within two spacings (empty areas). */
  readonly emptyShare: number;
}

/** Original lightness bands (L* 0…1). */
export const TONE_BANDS = { dark: 0.35, light: 0.7 } as const;

/**
 * Compares a drawing with the original, both as lightness fields of the SAME
 * size (L* 0…1, paper = 1). `scale` is the line spacing in px of these fields:
 * the eye averages the lines at about that scale, so both are blurred by it
 * before the tone is compared; structure is compared in the band between one
 * and four spacings (what a line drawing at that spacing can carry).
 * Blurring happens in linear light (Y), as optical mixing does; the results
 * are compared in L* again.
 */
export function compareRendering(original: ScalarField, drawing: ScalarField, scale: number): RenderingComparison {
  if (original.width !== drawing.width || original.height !== drawing.height) throw new RangeError('Fields must have the same size');
  const s = Math.max(0.5, scale);
  const yOriginal = mapField(original, yOfLightness);
  const yDrawing = mapField(drawing, yOfLightness);
  const seen = (y: ScalarField, sigma: number) => mapField(gaussianBlur(y, sigma), lightnessOfY);
  const seenOriginal = seen(yOriginal, s);
  const seenDrawing = seen(yDrawing, s);
  const coarseOriginal = seen(yOriginal, 4 * s);
  const coarseDrawing = seen(yDrawing, 4 * s);
  const bandOriginal = mapField(seenOriginal, (v, i) => v - coarseOriginal.data[i]!);
  const bandDrawing = mapField(seenDrawing, (v, i) => v - coarseDrawing.data[i]!);

  const band = (inBand: (l: number) => boolean): ToneBandComparison => {
    let n = 0, err = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (let i = 0; i < original.data.length; i++) {
      if (!inBand(seenOriginal.data[i]!)) continue;
      n++;
      err += Math.abs(seenOriginal.data[i]! - seenDrawing.data[i]!);
      const a = bandOriginal.data[i]!, b = bandDrawing.data[i]!;
      sa += a;
      sb += b;
      saa += a * a;
      sbb += b * b;
      sab += a * b;
    }
    if (n === 0) return { share: 0, toneError: 0, detailCorrelation: 0, detailGain: 0 };
    const cov = sab / n - (sa / n) * (sb / n);
    const va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
    return {
      share: n / original.data.length,
      toneError: err / n,
      detailCorrelation: va > 1e-12 && vb > 1e-12 ? cov / Math.sqrt(va * vb) : 0,
      detailGain: va > 1e-12 ? cov / va : 0,
    };
  };

  const near = seen(yDrawing, s / 2);
  const wide = seen(yDrawing, 2 * s);
  let closed = 0, empty = 0;
  for (let i = 0; i < drawing.data.length; i++) {
    if (near.data[i]! < 0.03) closed++;
    if (wide.data[i]! > 0.995) empty++;
  }
  return {
    light: band((l) => l >= TONE_BANDS.light),
    mid: band((l) => l >= TONE_BANDS.dark && l < TONE_BANDS.light),
    dark: band((l) => l < TONE_BANDS.dark),
    closedInkShare: closed / drawing.data.length,
    emptyShare: empty / drawing.data.length,
  };
}
