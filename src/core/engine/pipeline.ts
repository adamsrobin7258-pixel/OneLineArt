import type { ImageAnalyzer } from '../imageAnalysis';
import type { ImageOperation } from '../imageProcessing';
import { applyOperations } from '../imageProcessing';
import type { OneLinePath, OneLineSettings, RasterImage } from '../models';
import { createRandom } from '../utils';
import { validatePath } from './path';
import type { OneLinePathGenerator, PathOptimizer } from './types';

export interface OneLinePipelineConfig {
  readonly preprocess?: readonly ImageOperation[];
  readonly analyzer: ImageAnalyzer;
  readonly generator: OneLinePathGenerator;
  readonly optimizers?: readonly PathOptimizer[];
}

export interface OneLinePipelineRunOptions {
  readonly onProgress?: (progress: number) => void;
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
  const root = createRandom(settings.seed);
  const processed = applyOperations(image, config.preprocess ?? []);
  const analysis = config.analyzer.analyze(processed, root.fork('analysis'));
  const input = { image: processed, analysis, settings };

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
