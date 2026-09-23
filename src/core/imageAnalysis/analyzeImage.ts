import type { ProcessedImage, RasterImage } from '../models';
import { fitWithin } from '../imageProcessing';
import { AnalysisError } from './errors';
import { gaussianBlur, mapField, normalizeRobust, scharrGradient } from './filters';
import { detailDensityRaw, figureGroundRaw, localContrastRaw, textureRaw, weightedSum } from './layers';
import { luminanceField } from './luminance';
import { ANALYSIS_ALGORITHM_VERSION, DEFAULT_ANALYSIS_PARAMETERS, type AnalysisParameters } from './parameters';
import type { AnalysisMeta, ImageAnalysis, LayerNormalization } from './types';

export const STANDARD_ANALYZER_ID = 'standard';

/** Largest raster the analysis accepts as input (guards against absurd inputs). */
const MAX_INPUT_PIXELS = 100_000_000;

export function validateRaster(image: RasterImage): void {
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new AnalysisError('unexpected-dimensions', `Invalid size ${width}×${height}`);
  }
  if (width * height > MAX_INPUT_PIXELS) throw new AnalysisError('unexpected-dimensions', `Too large: ${width}×${height}`);
  if (!data || data.length === 0) throw new AnalysisError('image-unavailable', 'Pixel buffer is empty or detached');
  if (data.length !== width * height * 4) {
    throw new AnalysisError('invalid-image', `Buffer length ${data.length} does not match ${width}×${height} RGBA`);
  }
}

/**
 * Original pixels → analysis grid (luminance) → denoise → contrast, edges,
 * detail, texture → local importance → global relevance → importance.
 *
 * Pure and deterministic: identical input + parameters ⇒ identical output.
 * The input raster is only read, never modified.
 */
export function analyzeImage(
  image: RasterImage,
  parameters: AnalysisParameters = DEFAULT_ANALYSIS_PARAMETERS,
  sourceImageId: string | null = null,
): ImageAnalysis {
  validateRaster(image);
  const p = parameters;
  const size = fitWithin(image, Math.max(1, Math.floor(p.analysisMaxEdge)));
  const longEdge = Math.max(size.width, size.height);
  const px = (scale: number) => Math.max(1, scale * longEdge);
  const normalization: Record<string, LayerNormalization> = {};
  const normalize = (name: string, raw: Parameters<typeof normalizeRobust>[0], floor: number) => {
    const { field, robustMax, reference } = normalizeRobust(raw, p.normalizationPercentile, floor);
    normalization[name] = { robustMax, reference };
    return field;
  };

  // 1. Luminance on the analysis grid (absolute: L* / 100, no per-image stretching).
  const luminance = luminanceField(image, size);

  // 2. Light denoising for all derived layers; the luminance layer stays unsmoothed.
  const smoothed = gaussianBlur(luminance, p.denoiseSigma);
  const gradient = scharrGradient(smoothed);

  // 3. Local layers, each normalized robustly to [0, 1].
  const contrast = normalize('contrast', localContrastRaw(smoothed, px(p.contrastScale)), p.normalizationFloors.contrast);
  const edge = normalize('edge', gradient.magnitude, p.normalizationFloors.edge);
  const detail = normalize(
    'detail',
    detailDensityRaw(gradient, px(p.detailScale), p.detailThreshold.low, p.detailThreshold.high),
    p.normalizationFloors.detail,
  );
  const texture = normalize('texture', textureRaw(gradient, px(p.textureScale)), p.normalizationFloors.texture);

  const w = p.localWeights;
  const localImportance = weightedSum([
    [mapField(luminance, (v) => 1 - v), w.luminance],
    [contrast, w.contrast],
    [edge, w.edge],
    [detail, w.detail],
    [texture, w.texture],
  ]);

  // 4. Global relevance: large-scale structure instead of isolated local peaks.
  const regionDensity = normalize('regionDensity', gaussianBlur(localImportance, px(p.regionScale)), p.normalizationFloors.regionDensity);
  const figureGround = normalize(
    'figureGround',
    figureGroundRaw(smoothed, px(p.figureCenterScale), px(p.figureSurroundScale)),
    p.normalizationFloors.figureGround,
  );
  const globalRelevance = weightedSum([
    [regionDensity, p.globalWeights.regionDensity],
    [figureGround, p.globalWeights.figureGround],
  ]);

  // 5. Final importance: continuous blend, never thresholded.
  const blend = Math.min(1, Math.max(0, p.globalBlend));
  const importance = weightedSum([
    [localImportance, 1 - blend],
    [globalRelevance, blend],
  ]);

  const meta: AnalysisMeta = {
    analyzerId: STANDARD_ANALYZER_ID,
    algorithmVersion: ANALYSIS_ALGORITHM_VERSION,
    parameters: p,
    sourceSize: { width: image.width, height: image.height },
    scale: size.width / image.width,
    sourceImageId,
    normalization,
  };
  return { ...size, luminance, contrast, edge, detail, texture, localImportance, globalRelevance, importance, meta };
}

/** Analysis of a session's working copy; ties the result to its original image. */
export function analyzeProcessedImage(processed: ProcessedImage, parameters: AnalysisParameters = DEFAULT_ANALYSIS_PARAMETERS): ImageAnalysis {
  return analyzeImage(processed.pixels, parameters, processed.sourceImageId);
}
