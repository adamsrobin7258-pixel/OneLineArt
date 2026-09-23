import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_ALGORITHM_VERSION,
  ANALYSIS_LAYERS,
  AnalysisError,
  DEFAULT_ANALYSIS_PARAMETERS,
  analyzeImage,
  analyzeProcessedImage,
  createRandom,
  fieldStats,
  hashBytes,
  standardAnalyzer,
  withAnalysisParameters,
  type ImageAnalysis,
  type RasterImage,
  type ScalarField,
} from '../../../src/core';
import { checkerboard, copyRaster, halfEdge, noiseTexture, noisyFlat, raster, solid, stripes } from '../../fixtures/rasters';

const stats = (f: ScalarField) => fieldStats(f);
const at = (f: ScalarField, x: number, y: number) => f.data[Math.round(y) * f.width + Math.round(x)]!;
/** Mean of a layer over a rectangle given in analysis coordinates. */
function regionMean(f: ScalarField, x0: number, y0: number, x1: number, y1: number): number {
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, n++) sum += f.data[y * f.width + x]!;
  return sum / n;
}

function expectValidAnalysis(a: ImageAnalysis) {
  for (const name of ANALYSIS_LAYERS) {
    const layer = a[name];
    expect(layer.width, name).toBe(a.width);
    expect(layer.height, name).toBe(a.height);
    expect(layer.data.length, name).toBe(a.width * a.height);
    for (const v of layer.data) {
      if (!(Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error(`${name} has out-of-range value ${v}`);
    }
  }
}

describe('image analysis', () => {
  it('1. solid color: no contrast, edges, detail or texture; constant luminance and importance', () => {
    const a = analyzeImage(solid(200, 150, [90, 140, 200]));
    expectValidAnalysis(a);
    for (const name of ['contrast', 'edge', 'detail', 'texture'] as const) expect(stats(a[name]).max, name).toBeLessThan(1e-4);
    const lum = stats(a.luminance);
    expect(lum.max - lum.min).toBeLessThan(1e-5);
    const imp = stats(a.importance);
    expect(imp.max - imp.min).toBeLessThan(1e-4);
  });

  it('2. clear edge: edge layer peaks at the contour and is ~0 far from it', () => {
    const a = analyzeImage(halfEdge(200, 100));
    expectValidAnalysis(a);
    const mid = a.width / 2;
    expect(Math.max(at(a.edge, mid - 1, 50), at(a.edge, mid, 50))).toBeGreaterThan(0.9);
    expect(at(a.edge, 20, 50)).toBeLessThan(0.01);
    expect(at(a.edge, 180, 50)).toBeLessThan(0.01);
    // The contour matters more than the flat areas.
    expect(at(a.importance, mid, 50)).toBeGreaterThan(at(a.importance, 180, 50) + 0.3);
    // A single clean contour is coherent: little texture.
    expect(stats(a.texture).max).toBeLessThan(0.1);
  });

  it('3. high contrast: a strong pattern scores higher than a faint one in the same image', () => {
    // Left half: strong checker (20/235); right half: faint checker (120/136).
    const img = raster(320, 160, (x, y) => {
      const on = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 === 1;
      return x < 160 ? (on ? 235 : 20) : on ? 136 : 120;
    });
    const a = analyzeImage(img);
    expectValidAnalysis(a);
    const strong = regionMean(a.contrast, 10, 10, 150, 150);
    const faint = regionMean(a.contrast, 170, 10, 310, 150);
    expect(strong).toBeGreaterThan(faint * 4);
    expect(stats(a.contrast).max).toBeGreaterThan(0.99);
    expect(regionMean(a.importance, 10, 10, 150, 150)).toBeGreaterThan(regionMean(a.importance, 170, 10, 310, 150));
  });

  it('3b. contrast is LOCAL: a structured region on a flat background stands out', () => {
    const img = raster(300, 200, (x, y) => (x >= 100 && x < 200 && y >= 50 && y < 150 ? ((x + y) % 8 < 4 ? 80 : 170) : 128));
    const a = analyzeImage(img);
    expect(regionMean(a.contrast, 120, 70, 180, 130)).toBeGreaterThan(0.8);
    expect(regionMean(a.contrast, 10, 10, 60, 60)).toBeLessThan(0.05);
  });

  it('4. fine structures: high detail density; isotropic noise also counts as texture', () => {
    const noise = analyzeImage(noiseTexture(256, 256));
    expectValidAnalysis(noise);
    expect(stats(noise.detail).mean).toBeGreaterThan(0.6);
    expect(stats(noise.texture).mean).toBeGreaterThan(0.5);
  });

  it('4b. detail ≠ edges: fine stripes are dense, a single contour is not', () => {
    // At a realistic analysis size: the window is ~33 px, a contour band a few px.
    const edge = analyzeImage(halfEdge(800, 800));
    const fine = analyzeImage(stripes(800, 800));
    expect(stats(edge.edge).max).toBeGreaterThan(0.9);
    expect(stats(fine.edge).max).toBeGreaterThan(0.9);
    expect(stats(edge.detail).max).toBeLessThan(0.5);
    expect(stats(fine.detail).mean).toBeGreaterThan(0.8);
  });

  it('4c. texture ≠ edges/detail: coherent stripes have low texture, isotropic noise high', () => {
    const fine = analyzeImage(stripes(256, 256));
    const noise = analyzeImage(noiseTexture(256, 256));
    expect(stats(fine.texture).mean).toBeLessThan(0.05);
    expect(stats(noise.texture).mean).toBeGreaterThan(stats(fine.texture).mean + 0.5);
  });

  it('5. homogeneous image with sensor noise: noise is suppressed, not amplified', () => {
    const a = analyzeImage(noisyFlat(256, 256, 3));
    expectValidAnalysis(a);
    expect(stats(a.detail).max).toBeLessThan(0.05);
    expect(stats(a.edge).max).toBeLessThan(0.15);
    expect(stats(a.contrast).max).toBeLessThan(0.15);
    expect(stats(a.importance).max).toBeLessThan(0.35);
  });

  it.each([
    ['6. portrait', 900, 1600],
    ['7. landscape', 1600, 900],
    ['8. square', 1200, 1200],
  ])('%s: analysis grid keeps the aspect ratio', (_, width, height) => {
    const a = analyzeImage(halfEdge(width, height));
    expectValidAnalysis(a);
    expect(Math.max(a.width, a.height)).toBe(1024);
    expect(Math.abs(a.width / a.height / (width / height) - 1)).toBeLessThan(1 / Math.min(a.width, a.height));
    expect(a.meta.sourceSize).toEqual({ width, height });
  });

  it.each([
    [1, 1],
    [2, 1],
    [3, 2],
    [8, 6],
    [1, 40],
  ])('9. very small image %i×%i: valid layers, no upscaling', (width, height) => {
    const a = analyzeImage(raster(width, height, (x, y) => ((x + y) % 2 ? 40 : 210)));
    expectValidAnalysis(a);
    expect(a.width).toBe(width);
    expect(a.height).toBe(height);
    expect(a.meta.scale).toBe(1);
  });

  it('10. large image: analysed on the configured grid, not at full resolution', () => {
    const img = raster(4000, 3000, (x, y) => ((x >> 5) + (y >> 5)) % 2 ? 40 : 210);
    const started = performance.now();
    const a = analyzeImage(img);
    const ms = performance.now() - started;
    expectValidAnalysis(a);
    expect(a.width).toBe(1024);
    expect(a.height).toBe(768);
    expect(a.meta.scale).toBeCloseTo(1024 / 4000, 6);
    expect(ms).toBeLessThan(10_000);
  });

  it('11. deterministic: identical input + parameters ⇒ bit-identical layers', () => {
    const img = noiseTexture(300, 200, 11);
    const a = analyzeImage(img);
    const b = analyzeImage(copyRaster(img));
    for (const name of ANALYSIS_LAYERS) expect(Buffer.from(a[name].data.buffer).equals(Buffer.from(b[name].data.buffer)), name).toBe(true);
    expect(a.meta).toEqual(b.meta);
  });

  it('11b. the pipeline analyzer ignores randomness', () => {
    const img = noiseTexture(64, 64);
    const a = standardAnalyzer.analyze(img, createRandom(1));
    const b = standardAnalyzer.analyze(img, createRandom(999));
    expect(a.importance.data).toEqual(b.importance.data);
  });

  it('13. every layer stays in [0, 1] for varied inputs', () => {
    const inputs: RasterImage[] = [
      solid(10, 10, 0),
      solid(10, 10, 255),
      checkerboard(64, 64, 1),
      checkerboard(64, 64, 1, 0, 255),
      noiseTexture(80, 60, 5, 0, 255),
      raster(70, 50, (x, y) => [(x * 37) % 256, (y * 91) % 256, ((x + y) * 13) % 256]),
      raster(40, 40, () => [255, 0, 0], 100),
    ];
    for (const img of inputs) expectValidAnalysis(analyzeImage(img));
  });

  it('13b. importance is continuous, not a binary mask', () => {
    const img = raster(256, 256, (x, y) => {
      const d = Math.hypot(x - 128, y - 128);
      return d < 60 ? ((x + y) % 6 < 3 ? 70 : 180) : 128 + Math.round(40 * Math.sin(x / 20));
    });
    const imp = analyzeImage(img).importance;
    const distinct = new Set(Array.from(imp.data, (v) => Math.round(v * 100)));
    expect(distinct.size).toBeGreaterThan(20);
    expect([...imp.data].some((v) => v > 0.05 && v < 0.95)).toBe(true);
  });

  it('14. uses the configured analysis resolution and records parameters and version', () => {
    const params = withAnalysisParameters(DEFAULT_ANALYSIS_PARAMETERS, { analysisMaxEdge: 256 });
    const a = analyzeImage(halfEdge(1000, 500), params);
    expect([a.width, a.height]).toEqual([256, 128]);
    expect(a.meta.parameters.analysisMaxEdge).toBe(256);
    expect(a.meta.algorithmVersion).toBe(ANALYSIS_ALGORITHM_VERSION);
    expect(a.meta.analyzerId).toBe('standard');
    expect(a.meta.normalization.edge?.reference).toBeGreaterThan(0);
  });

  it('15. never modifies the input image', () => {
    const img = noiseTexture(320, 240, 4);
    const before = hashBytes(img.data);
    const copy = new Uint8ClampedArray(img.data);
    analyzeImage(img);
    expect(hashBytes(img.data)).toBe(before);
    expect(img.data).toEqual(copy);
  });

  it('ties the analysis to its original image', () => {
    const pixels = halfEdge(40, 30);
    const a = analyzeProcessedImage({ sourceImageId: 'img-42', pixels, scale: 1 });
    expect(a.meta.sourceImageId).toBe('img-42');
    expect(analyzeImage(pixels).meta.sourceImageId).toBeNull();
  });

  describe('importance weighting', () => {
    it('follows the central weights (edge-only weights ⇒ local importance = edge layer)', () => {
      const params = withAnalysisParameters(DEFAULT_ANALYSIS_PARAMETERS, {
        localWeights: { luminance: 0, contrast: 0, edge: 1, detail: 0, texture: 0 },
        globalBlend: 0,
      });
      const a = analyzeImage(halfEdge(120, 80), params);
      for (let i = 0; i < a.edge.data.length; i++) expect(a.importance.data[i]).toBeCloseTo(a.edge.data[i]!, 5);
    });

    it('darker tones weigh more via the luminance component', () => {
      const params = withAnalysisParameters(DEFAULT_ANALYSIS_PARAMETERS, {
        localWeights: { luminance: 1, contrast: 0, edge: 0, detail: 0, texture: 0 },
        globalBlend: 0,
      });
      expect(stats(analyzeImage(solid(20, 20, 30), params).importance).mean).toBeGreaterThan(stats(analyzeImage(solid(20, 20, 220), params).importance).mean);
    });

    it('global relevance favours a large object over an isolated small speck', () => {
      // White background, a tiny dark speck top-left, a large mid-gray textured object bottom-right.
      const img = raster(512, 512, (x, y) =>
        (x - 60) ** 2 + (y - 60) ** 2 < 25 ? 0 : (x - 350) ** 2 + (y - 300) ** 2 < 110 ** 2 ? 170 + ((x + y) % 7) * 3 : 230,
      );
      const a = analyzeImage(img);
      const s = a.width / 512;
      expect(at(a.localImportance, 60 * s, 60 * s)).toBeGreaterThan(at(a.localImportance, 350 * s, 300 * s));
      expect(at(a.globalRelevance, 350 * s, 300 * s)).toBeGreaterThan(at(a.globalRelevance, 60 * s, 60 * s) + 0.2);
      // The blend reduces the gap between speck and object compared to local importance alone.
      const localGap = at(a.localImportance, 60 * s, 60 * s) - at(a.localImportance, 350 * s, 300 * s);
      const finalGap = at(a.importance, 60 * s, 60 * s) - at(a.importance, 350 * s, 300 * s);
      expect(finalGap).toBeLessThan(localGap);
    });

    it('keeps local and global information available separately', () => {
      const a = analyzeImage(halfEdge(100, 100));
      expect(a.localImportance).not.toBe(a.importance);
      expect(a.globalRelevance).not.toBe(a.importance);
    });
  });

  describe('errors', () => {
    const expectCode = (fn: () => unknown, code: string) => {
      try {
        fn();
      } catch (error) {
        expect(error).toBeInstanceOf(AnalysisError);
        expect((error as AnalysisError).code).toBe(code);
        return;
      }
      throw new Error('expected an AnalysisError');
    };

    it('rejects zero or invalid dimensions', () => {
      expectCode(() => analyzeImage({ width: 0, height: 10, data: new Uint8ClampedArray(0) }), 'unexpected-dimensions');
      expectCode(() => analyzeImage({ width: 2.5, height: 10, data: new Uint8ClampedArray(100) }), 'unexpected-dimensions');
    });

    it('rejects a buffer that does not match the dimensions', () => {
      expectCode(() => analyzeImage({ width: 10, height: 10, data: new Uint8ClampedArray(10) }), 'invalid-image');
    });

    it('reports detached / missing pixel data as unavailable', () => {
      expectCode(() => analyzeImage({ width: 10, height: 10, data: new Uint8ClampedArray(0) }), 'image-unavailable');
    });
  });
});
