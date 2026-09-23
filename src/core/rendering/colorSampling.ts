import type { OneLinePath, RasterImage } from '../models';
import { linearToOklab, linearToSrgb8, oklabToLinear, SRGB_TO_LINEAR } from './colorSpace';
import type { ColorSamplingSettings } from './renderSettings';

/** Samples per axis in the station neighbourhood (grid of N×N). */
const NEIGHBOURHOOD_GRID = 5;
/**
 * Minimum neighbourhood radius in IMAGE pixels: below this the grid would hit
 * the same pixel repeatedly and the robust mean could not reject outliers.
 */
const MIN_SAMPLE_RADIUS_IMAGE_PX = 2;
/**
 * Stations need not be denser than the colour smoothing can resolve:
 * at most this many stations per smoothing sigma.
 */
const STATIONS_PER_SMOOTHING_SIGMA = 4;

/** In-place insertion sort — faster than TypedArray#sort for the 25 samples per station. */
function sortSmall(values: Float64Array): void {
  for (let i = 1; i < values.length; i++) {
    const v = values[i]!;
    let j = i - 1;
    while (j >= 0 && values[j]! > v) {
      values[j + 1] = values[j]!;
      j--;
    }
    values[j + 1] = v;
  }
}

/**
 * Colour of the line at every path vertex (sRGB bytes, 3 per vertex), derived
 * from the photo. The geometry is not touched: colours are data ALONGSIDE the
 * one OneLinePath.
 */
export interface LineColors {
  /** r,g,b per path vertex. */
  readonly rgb: Uint8ClampedArray;
  readonly vertexCount: number;
  /** Number of sampling stations along the path. */
  readonly stations: number;
  /** Station spacing, neighbourhood radius and smoothing sigma in path (image) px. */
  readonly stationSpacingPx: number;
  readonly sampleRadiusPx: number;
  readonly smoothingPx: number;
}

/** Three successive box blurs ≈ Gaussian, along a 1D signal (edges clamped). */
function smooth1d(values: Float64Array, sigma: number): Float64Array {
  if (!(sigma > 0.5) || values.length < 3) return values;
  const radius = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
  let src = values;
  for (let pass = 0; pass < 3; pass++) {
    const dst = new Float64Array(src.length);
    const n = src.length;
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += src[Math.min(n - 1, Math.max(0, i))]!;
    for (let i = 0; i < n; i++) {
      dst[i] = sum / (2 * radius + 1);
      sum += src[Math.min(n - 1, i + radius + 1)]! - src[Math.max(0, i - radius)]!;
    }
    src = dst;
  }
  return src;
}

/**
 * Deterministic colour sampling along the path:
 *  1. stations every `stationSpacing` of arc length (not at raw points)
 *  2. N×N neighbourhood per station, composited over white, in linear light
 *  3. trimmed mean per channel (drops outliers)
 *  4. Gaussian smoothing of the colour flow along the arc length
 *  5. OKLab: lightness limited to a readable range, chroma × strength
 *  6. every vertex takes the colour of its station
 */
export function sampleLineColors(path: OneLinePath, image: RasterImage, settings: ColorSamplingSettings, darkBackground = false): LineColors {
  const c = path.coords;
  const n = c.length >> 1;
  const longEdge = Math.max(path.bounds.width, path.bounds.height);
  const toImageX = image.width / path.bounds.width;
  const toImageY = image.height / path.bounds.height;
  const spacing = Math.max(0.5, settings.stationSpacing * longEdge, (settings.smoothing * longEdge) / STATIONS_PER_SMOOTHING_SIGMA);
  const pathPxPerImagePx = Math.max(1 / toImageX, 1 / toImageY);
  const radius = settings.sampleRadius > 0 ? Math.max(settings.sampleRadius * longEdge, MIN_SAMPLE_RADIUS_IMAGE_PX * pathPxPerImagePx) : 0;

  // Arc length per vertex.
  const arc = new Float64Array(n);
  for (let i = 1; i < n; i++) arc[i] = arc[i - 1]! + Math.hypot(c[i * 2]! - c[i * 2 - 2]!, c[i * 2 + 1]! - c[i * 2 - 1]!);
  const total = n ? arc[n - 1]! : 0;
  const stations = Math.max(1, Math.floor(total / spacing) + 1);

  const lin = [new Float64Array(stations), new Float64Array(stations), new Float64Array(stations)] as const;
  const g = NEIGHBOURHOOD_GRID;
  const buffer = [new Float64Array(g * g), new Float64Array(g * g), new Float64Array(g * g)] as const;
  const trim = Math.min(Math.floor(g * g * settings.outlierTrim), Math.floor((g * g - 1) / 2));

  let seg = 0;
  for (let k = 0; k < stations; k++) {
    // Position on the path at arc length k·spacing.
    const s = Math.min(total, k * spacing);
    while (seg < n - 2 && arc[seg + 1]! < s) seg++;
    const len = n > 1 ? arc[seg + 1]! - arc[seg]! : 0;
    const t = len > 0 ? (s - arc[seg]!) / len : 0;
    const px = n > 1 ? c[seg * 2]! + (c[seg * 2 + 2]! - c[seg * 2]!) * t : c[0] ?? 0;
    const py = n > 1 ? c[seg * 2 + 1]! + (c[seg * 2 + 3]! - c[seg * 2 + 1]!) * t : c[1] ?? 0;

    let m = 0;
    for (let gy = 0; gy < g; gy++) {
      for (let gx = 0; gx < g; gx++) {
        const ox = g > 1 ? (gx / (g - 1) - 0.5) * 2 * radius : 0;
        const oy = g > 1 ? (gy / (g - 1) - 0.5) * 2 * radius : 0;
        const ix = Math.min(image.width - 1, Math.max(0, Math.floor((px + ox) * toImageX)));
        const iy = Math.min(image.height - 1, Math.max(0, Math.floor((py + oy) * toImageY)));
        const o = (iy * image.width + ix) * 4;
        const a = image.data[o + 3]! / 255;
        for (let ch = 0; ch < 3; ch++) buffer[ch]![m] = SRGB_TO_LINEAR[image.data[o + ch]!]! * a + (1 - a);
        m++;
      }
    }
    for (let ch = 0; ch < 3; ch++) {
      const values = buffer[ch]!;
      sortSmall(values);
      let sum = 0;
      for (let i = trim; i < values.length - trim; i++) sum += values[i]!;
      lin[ch]![k] = sum / (values.length - 2 * trim);
    }
  }

  // Smooth the colour flow along the line (in linear light).
  const sigmaStations = (settings.smoothing * longEdge) / spacing;
  const smoothed = lin.map((channel) => smooth1d(channel, sigmaStations));

  // Readable, designed colour: limit lightness, scale chroma.
  const range = darkBackground ? settings.darkLightness : settings.lightLightness;
  const stationRgb = new Uint8ClampedArray(stations * 3);
  for (let k = 0; k < stations; k++) {
    const [L, a, b] = linearToOklab(smoothed[0]![k]!, smoothed[1]![k]!, smoothed[2]![k]!);
    const [r, gg, bb] = oklabToLinear(Math.min(range.max, Math.max(range.min, L)), a * settings.strength, b * settings.strength);
    stationRgb[k * 3] = linearToSrgb8(r);
    stationRgb[k * 3 + 1] = linearToSrgb8(gg);
    stationRgb[k * 3 + 2] = linearToSrgb8(bb);
  }

  const rgb = new Uint8ClampedArray(n * 3);
  for (let i = 0; i < n; i++) {
    const k = Math.min(stations - 1, Math.round(arc[i]! / spacing));
    rgb[i * 3] = stationRgb[k * 3]!;
    rgb[i * 3 + 1] = stationRgb[k * 3 + 1]!;
    rgb[i * 3 + 2] = stationRgb[k * 3 + 2]!;
  }
  return { rgb, vertexCount: n, stations, stationSpacingPx: spacing, sampleRadiusPx: radius, smoothingPx: settings.smoothing * longEdge };
}
