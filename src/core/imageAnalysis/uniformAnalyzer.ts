import type { ImageAnalyzer } from './types';

/** TEMPORARY stand-in until part 3: every pixel equally important. */
export const uniformAnalyzer: ImageAnalyzer = {
  id: 'uniform',
  analyze(image) {
    return {
      importance: { width: image.width, height: image.height, data: new Float32Array(image.width * image.height).fill(1) },
    };
  },
};
