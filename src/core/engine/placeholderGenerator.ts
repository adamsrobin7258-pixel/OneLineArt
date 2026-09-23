import type { Point } from '../models';
import { clamp } from '../utils';
import { createPath } from './path';
import type { OneLinePathGenerator } from './types';

/**
 * TEMPORARY stand-in until part 4: a seeded random walk that ignores the
 * image content. Exists only to exercise the pipeline, rendering and
 * animation end to end. Not the One-Line algorithm.
 */
export const placeholderGenerator: OneLinePathGenerator = {
  id: 'placeholder-random-walk',
  version: '0.0.1',
  generate({ image, settings }, { rng, onProgress }) {
    const { width, height } = image;
    const count = Math.max(2, Math.min(settings.maxPoints, Math.round(200 + settings.detail * 1800)));
    const step = Math.min(width, height) * 0.02;
    const points: Point[] = [];
    let x = width / 2;
    let y = height / 2;
    let heading = rng.range(0, Math.PI * 2);
    for (let i = 0; i < count; i++) {
      points.push({ x, y });
      heading += rng.range(-0.6, 0.6);
      x = clamp(x + Math.cos(heading) * step, 0, width);
      y = clamp(y + Math.sin(heading) * step, 0, height);
    }
    onProgress?.(1);
    return createPath(points, { width, height }, { generatorId: this.id, generatorVersion: this.version, seed: settings.seed });
  },
};
