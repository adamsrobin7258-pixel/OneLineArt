import { expect, test } from '@playwright/test';

/** Module URLs served by the Vite dev server (imported inside the page). */
const MODULES = { core: '/src/core/index.ts', renderer: '/src/platform/browser/artworkRenderer.ts' };
type Core = typeof import('../src/core');
type Renderer = typeof import('../src/platform/browser/artworkRenderer');

/**
 * Pixel-level checks of the real canvas renderer (platform/browser/artworkRenderer)
 * with synthetic paths and images, run inside Chromium.
 */
test.describe('artwork renderer (real canvas)', () => {
  test.beforeEach(async ({ page }) => page.goto('/'));

  test('monochrome: black antialiased line on white, exact size, resolution-normalized width, deterministic', async ({ page }) => {
    const result = await page.evaluate(async (urls) => {
      const core = (await import(urls.core)) as Core;
      const { renderArtwork } = (await import(urls.renderer)) as Renderer;
      // A diagonal zigzag across a 400×300 canvas.
      const points = Array.from({ length: 40 }, (_, i) => ({ x: 10 + (i / 39) * 380, y: i % 2 ? 250 : 50 }));
      const path = core.createPath(points, { width: 400, height: 300 }, { generatorId: 't', generatorVersion: '1', seed: 0 });
      const read = (bitmap: ImageBitmap) => {
        const c = new OffscreenCanvas(bitmap.width, bitmap.height);
        const x = c.getContext('2d')!;
        x.drawImage(bitmap, 0, 0);
        return x.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const stats = (data: Uint8ClampedArray) => {
        let dark = 0, partial = 0, white = 0, ink = 0;
        for (let i = 0; i < data.length; i += 4) {
          const v = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
          if (v < 60) dark++;
          else if (v < 250) partial++;
          else white++;
          ink += (255 - v) / 255;
        }
        const px = data.length / 4;
        return { dark, partial, white, inkShare: ink / px, corner: [data[0], data[1], data[2], data[3]] };
      };
      const small = await renderArtwork({ path, settings: core.DEFAULT_RENDER_SETTINGS, longEdge: 1000 });
      const large = await renderArtwork({ path, settings: core.DEFAULT_RENDER_SETTINGS, longEdge: 4000 });
      const again = await renderArtwork({ path, settings: core.DEFAULT_RENDER_SETTINGS, longEdge: 1000 });
      const s = stats(read(small.image));
      const l = stats(read(large.image));
      return {
        smallSize: [small.size.width, small.size.height],
        largeSize: [large.size.width, large.size.height],
        small: s,
        large: l,
        sameHash: core.hashBytes(read(small.image)) === core.hashBytes(read(again.image)),
        metrics: small.metrics,
      };
    }, MODULES);
    expect(result.smallSize).toEqual([1000, 750]);
    expect(result.largeSize).toEqual([4000, 3000]);
    expect(result.small.corner).toEqual([255, 255, 255, 255]); // white background
    expect(result.small.white).toBeGreaterThan(result.small.dark * 5);
    expect(result.small.partial).toBeGreaterThan(0); // antialiased edges, no hard pixel steps
    // Same RELATIVE ink coverage at 1000 and 4000 px: the line does not get 4× thinner.
    expect(Math.abs(result.small.inkShare - result.large.inkShare) / result.small.inkShare).toBeLessThan(0.12);
    expect(result.sameHash).toBe(true);
    expect(result.metrics).toMatchObject({ renderWidth: 1000, renderHeight: 750, renderColorMode: 'monochrome', strokeRuns: 1 });
    expect(result.metrics.renderRuntimeMs).toBeGreaterThan(0);
  });

  test('colour: the line takes its colours from the image; opacity lightens it; original stays untouched', async ({ page }) => {
    const result = await page.evaluate(async (urls) => {
      const core = (await import(urls.core)) as Core;
      const { renderArtwork } = (await import(urls.renderer)) as Renderer;
      const w = 400, h = 200;
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(x < w / 2 ? [210, 40, 40, 255] : [40, 60, 210, 255], (y * w + x) * 4);
      const image = { width: w, height: h, data };
      const before = core.hashBytes(data);
      const points = [];
      for (let r = 0; r < 8; r++) for (let i = 0; i <= 80; i++) points.push({ x: 5 + ((r % 2 ? 80 - i : i) / 80) * 390, y: 12 + r * 25 });
      const path = core.createPath(points, { width: w, height: h }, { generatorId: 't', generatorVersion: '1', seed: 0 });
      const settings = { ...core.DEFAULT_RENDER_SETTINGS, colorMode: 'sampled-color' as const, lineWidth: 4 };
      const art = await renderArtwork({ path, settings, longEdge: 800, image });
      const faint = await renderArtwork({ path, settings: { ...settings, lineOpacity: 0.4 }, longEdge: 800, image });
      const sample = (bitmap: ImageBitmap, fx: number) => {
        const c = new OffscreenCanvas(bitmap.width, bitmap.height);
        const x = c.getContext('2d')!;
        x.drawImage(bitmap, 0, 0);
        const d = x.getImageData(Math.round(fx * bitmap.width), Math.round((12 / h) * bitmap.height), 1, 1).data;
        return [d[0]!, d[1]!, d[2]!];
      };
      return { left: sample(art.image, 0.2), right: sample(art.image, 0.8), faintLeft: sample(faint.image, 0.2), runs: art.metrics.strokeRuns, sampled: art.metrics.colorSampling, unchanged: core.hashBytes(data) === before };
    }, MODULES);
    expect(result.left[0]).toBeGreaterThan(result.left[2]! + 60); // red region → red line
    expect(result.right[2]).toBeGreaterThan(result.right[0]! + 60); // blue region → blue line
    expect(result.faintLeft[0]).toBeGreaterThan(result.left[0]!); // lighter with lower opacity
    expect(result.faintLeft[1]).toBeGreaterThan(result.left[1]! + 40);
    expect(result.runs).toBeGreaterThan(1);
    expect(result.sampled).toBe(true);
    expect(result.unchanged).toBe(true);
  });
});
