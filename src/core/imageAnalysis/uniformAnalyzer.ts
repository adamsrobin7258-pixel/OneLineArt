import { DEFAULT_ANALYSIS_PARAMETERS } from './parameters';
import { ANALYSIS_LAYERS, type ImageAnalysis, type ImageAnalyzer } from './types';

/** Test stand-in: every pixel equally important, all other layers flat. Analysis size = image size. */
export const uniformAnalyzer: ImageAnalyzer = {
  id: 'uniform',
  analyze(image) {
    const { width, height } = image;
    const layer = (value: number) => ({ width, height, data: new Float32Array(width * height).fill(value) });
    const layers = Object.fromEntries(ANALYSIS_LAYERS.map((name) => [name, layer(name === 'importance' ? 1 : 0)]));
    return {
      width,
      height,
      ...layers,
      meta: {
        analyzerId: 'uniform',
        algorithmVersion: '0',
        parameters: DEFAULT_ANALYSIS_PARAMETERS,
        sourceSize: { width, height },
        scale: 1,
        sourceImageId: null,
        normalization: {},
      },
    } as ImageAnalysis;
  },
};
