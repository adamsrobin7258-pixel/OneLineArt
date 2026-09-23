import {
  DEFAULT_ENGINE_PARAMETERS,
  DEFAULT_ONE_LINE_SETTINGS,
  analyzeImage,
  createRandom,
  generateOneLine,
  type OneLineEngineParameters,
  type OneLinePath,
  type OneLineSettings,
  type RasterImage,
} from '../../../src/core';

/** Smaller budget so the suite stays fast; the algorithm is identical. */
export const TEST_PARAMETERS: OneLineEngineParameters = {
  ...DEFAULT_ENGINE_PARAMETERS,
  workingMaxEdge: 240,
  pointBudget: { min: 800, max: 4000 },
  relaxationIterations: 6,
};

/** Runs analysis + engine like the pipeline does (RNG seeded from settings.seed). */
export function run(image: RasterImage, overrides: Partial<OneLineEngineParameters> = {}, settings: Partial<OneLineSettings> = {}) {
  const analysis = analyzeImage(image, undefined, 'img-test');
  const fullSettings = { ...DEFAULT_ONE_LINE_SETTINGS, ...settings };
  return {
    analysis,
    ...generateOneLine({ image, analysis, settings: fullSettings }, { ...TEST_PARAMETERS, ...overrides }, { rng: createRandom(fullSettings.seed) }),
  };
}

/** Path length inside a rectangle (segments split finely), divided by its area. */
export function lengthDensity(path: OneLinePath, x0: number, y0: number, x1: number, y1: number): number {
  const c = path.coords;
  let inside = 0;
  for (let i = 2; i < c.length; i += 2) {
    const ax = c[i - 2]!, ay = c[i - 1]!, bx = c[i]!, by = c[i + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    const pieces = Math.max(1, Math.ceil(len));
    for (let s = 0; s < pieces; s++) {
      const t = (s + 0.5) / pieces;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) inside += len / pieces;
    }
  }
  return inside / ((x1 - x0) * (y1 - y0));
}
