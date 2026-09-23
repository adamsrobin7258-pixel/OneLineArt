import type { ImageAnalysis, ImageAnalyzer } from '../imageAnalysis';
import type { ImageOperation } from '../imageProcessing';
import { applyOperations } from '../imageProcessing';
import type { OneLinePath, OneLineSettings, RasterImage } from '../models';
import { createRandom } from '../utils';
import { validatePath } from './path';
import type { OneLinePathGenerator, PathOptimizer } from './types';

export interface PathGenerationConfig {
  readonly generator: OneLinePathGenerator;
  readonly optimizers?: readonly PathOptimizer[];
}

export interface OneLinePipelineConfig extends PathGenerationConfig {
  readonly preprocess?: readonly ImageOperation[];
  readonly analyzer: ImageAnalyzer;
}

export interface OneLinePipelineRunOptions {
  readonly onProgress?: (progress: number) => void;
}

/**
 * Hand-over point from analysis to the One-Line engine (part 4):
 * ImageAnalysis (+ the working image) + settings → one validated OneLinePath.
 * Takes no UI state; the analysis can come from a worker or a cache.
 */
export function generateOneLinePath(
  config: PathGenerationConfig,
  source: { readonly image: RasterImage; readonly analysis: ImageAnalysis },
  settings: OneLineSettings,
  options: OneLinePipelineRunOptions = {},
): OneLinePath {
  const root = createRandom(settings.seed);
  const input = { image: source.image, analysis: source.analysis, settings };

  let path = config.generator.generate(input, {
    rng: root.fork('generate'),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
  for (const optimizer of config.optimizers ?? []) {
    path = optimizer.optimize(path, input, root.fork(`optimize:${optimizer.id}`));
  }

  const validation = validatePath(path);
  if (!validation.valid) {
    throw new Error(`Pipeline produced an invalid path: ${validation.errors.join(' ')}`);
  }
  return path;
}

/**
 * Original image -> preprocessing -> analysis/weighting -> path generation
 * -> optimization. Rendering happens separately from the returned path.
 *
 * Each stage gets its own RNG stream forked from the seed, so adding
 * randomness to one stage never changes the output of another.
 */
export function runOneLinePipeline(
  config: OneLinePipelineConfig,
  image: RasterImage,
  settings: OneLineSettings,
  options: OneLinePipelineRunOptions = {},
): OneLinePath {
  const processed = applyOperations(image, config.preprocess ?? []);
  const analysis = config.analyzer.analyze(processed, createRandom(settings.seed).fork('analysis'));
  return generateOneLinePath(config, { image: processed, analysis }, settings, options);
}
