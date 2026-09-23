/**
 * Bump whenever the analysis output for identical input + parameters changes.
 * Recorded in every ImageAnalysis for traceability.
 */
export const ANALYSIS_ALGORITHM_VERSION = '1.0.0';

/** Relative weights of the local layers in the local importance. Normalized by their sum. */
export interface LocalImportanceWeights {
  /** Contributes darkness (1 − luminance): darker tones need more line. */
  readonly luminance: number;
  readonly contrast: number;
  readonly edge: number;
  readonly detail: number;
  readonly texture: number;
}

/** Relative weights of the components of the global relevance. */
export interface GlobalRelevanceWeights {
  /** Where local importance is concentrated over a large area (objects vs. isolated specks). */
  readonly regionDensity: number;
  /** Coarse center-surround tone difference (figure vs. background). */
  readonly figureGround: number;
}

/**
 * Lower bounds for the normalization reference of each layer, in raw layer
 * units (luminance ∈ [0,1], gradients in luminance per analysis pixel).
 * They prevent amplifying noise in flat images to full scale.
 */
export interface NormalizationFloors {
  readonly contrast: number;
  readonly edge: number;
  readonly detail: number;
  readonly texture: number;
  readonly regionDensity: number;
  readonly figureGround: number;
}

/**
 * Every tunable of the analysis in one place. Part 5 derives detail levels
 * (e.g. minimal / balanced / detail) by providing different parameter sets.
 *
 * Spatial sizes named `…Scale` are fractions of the analysis long edge, so
 * results stay comparable when `analysisMaxEdge` changes.
 */
export interface AnalysisParameters {
  /** Long edge of the internal analysis grid (never upscaled). */
  readonly analysisMaxEdge: number;
  /** Gaussian pre-smoothing against sensor noise / JPEG artefacts, in analysis pixels. */
  readonly denoiseSigma: number;
  /** Window radius for local standard deviation (contrast). */
  readonly contrastScale: number;
  /** Window radius for the density of significant changes (detail). */
  readonly detailScale: number;
  /** Gradient magnitude range mapped softly to "significant change" (luminance per pixel). */
  readonly detailThreshold: { readonly low: number; readonly high: number };
  /** Integration sigma of the structure tensor (texture). */
  readonly textureScale: number;
  readonly regionScale: number;
  readonly figureCenterScale: number;
  readonly figureSurroundScale: number;
  /** Robust maximum used for normalization (percentile in [0,1]). */
  readonly normalizationPercentile: number;
  readonly normalizationFloors: NormalizationFloors;
  readonly localWeights: LocalImportanceWeights;
  readonly globalWeights: GlobalRelevanceWeights;
  /** importance = (1 − globalBlend) · local + globalBlend · global. */
  readonly globalBlend: number;
}

export const DEFAULT_ANALYSIS_PARAMETERS: AnalysisParameters = {
  analysisMaxEdge: 1024,
  denoiseSigma: 1,
  contrastScale: 0.01,
  detailScale: 0.02,
  detailThreshold: { low: 0.012, high: 0.045 },
  textureScale: 0.008,
  regionScale: 0.05,
  figureCenterScale: 0.04,
  figureSurroundScale: 0.15,
  normalizationPercentile: 0.99,
  normalizationFloors: { contrast: 0.06, edge: 0.08, detail: 0.6, texture: 0.05, regionDensity: 0.15, figureGround: 0.05 },
  localWeights: { luminance: 0.15, contrast: 0.2, edge: 0.35, detail: 0.2, texture: 0.1 },
  globalWeights: { regionDensity: 0.6, figureGround: 0.4 },
  globalBlend: 0.3,
};

/** Deep-merges partial overrides (e.g. from a future detail level) onto a base parameter set. */
export function withAnalysisParameters(
  base: AnalysisParameters,
  overrides: {
    readonly [K in keyof AnalysisParameters]?: AnalysisParameters[K] extends number ? number : Partial<AnalysisParameters[K]>;
  },
): AnalysisParameters {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const current = (base as unknown as Record<string, unknown>)[key];
    merged[key] = typeof value === 'object' && value !== null && typeof current === 'object' ? { ...current, ...value } : value;
  }
  return merged as unknown as AnalysisParameters;
}
