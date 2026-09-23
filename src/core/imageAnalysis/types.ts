import type { RasterImage, ScalarField, Size } from '../models';
import type { Random } from '../utils';
import type { AnalysisParameters } from './parameters';

/** All layers of an analysis. Every layer is a ScalarField of the same size with values in [0, 1]. */
export const ANALYSIS_LAYERS = [
  'luminance',
  'contrast',
  'edge',
  'detail',
  'texture',
  'localImportance',
  'globalRelevance',
  'importance',
] as const;

export type AnalysisLayerName = (typeof ANALYSIS_LAYERS)[number];

/** How a layer's raw values were mapped to [0, 1]: normalized = min(raw / reference, 1). */
export interface LayerNormalization {
  /** Robust maximum (percentile) of the raw values. */
  readonly robustMax: number;
  /** Divisor actually used: max(robustMax, floor). */
  readonly reference: number;
}

export interface AnalysisMeta {
  readonly analyzerId: string;
  readonly algorithmVersion: string;
  readonly parameters: AnalysisParameters;
  /** Size of the raster that was analysed (the processed image). */
  readonly sourceSize: Size;
  /** analysis size / source size (≤ 1). */
  readonly scale: number;
  /** Id of the OriginalImage this analysis belongs to, when known. */
  readonly sourceImageId: string | null;
  readonly normalization: Readonly<Partial<Record<AnalysisLayerName | 'regionDensity' | 'figureGround', LayerNormalization>>>;
}

/**
 * Structured description of the visual content of ONE image; the hand-over
 * point to the One-Line engine (part 4). Contains no line, only weights.
 *
 * - luminance:       perceptual lightness (CIE L*), 0 = black, 1 = white
 * - contrast:        local standard deviation of luminance
 * - edge:            gradient magnitude (Scharr on denoised luminance)
 * - detail:          local density of significant changes (how MANY, not how strong)
 * - texture:         isotropic gradient energy (many changes without one dominant direction)
 * - localImportance: weighted combination of the local layers
 * - globalRelevance: large-scale relevance (object regions, figure vs. ground)
 * - importance:      final continuous weight map for the engine
 */
export type ImageAnalysis = Size & { readonly [K in AnalysisLayerName]: ScalarField } & { readonly meta: AnalysisMeta };

export interface ImageAnalyzer {
  readonly id: string;
  /** Must be deterministic. `rng` exists for analyzers that sample; the standard analyzer ignores it. */
  analyze(image: RasterImage, rng: Random): ImageAnalysis;
}
