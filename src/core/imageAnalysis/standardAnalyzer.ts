import { analyzeImage, STANDARD_ANALYZER_ID } from './analyzeImage';
import { DEFAULT_ANALYSIS_PARAMETERS, type AnalysisParameters } from './parameters';
import type { ImageAnalyzer } from './types';

/** The pipeline-facing analyzer (Part 1 interface) backed by the standard analysis. */
export function createStandardAnalyzer(parameters: AnalysisParameters = DEFAULT_ANALYSIS_PARAMETERS): ImageAnalyzer {
  return { id: STANDARD_ANALYZER_ID, analyze: (image) => analyzeImage(image, parameters) };
}

export const standardAnalyzer = createStandardAnalyzer();
