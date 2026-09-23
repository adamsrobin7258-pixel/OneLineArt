import { expect, test } from '@playwright/test';
import { createArtwork, exportAndDownload, exportScreen, goToExport, probeVideo, trackWorkers, videoPanel, workers } from './exportHelpers';

type Core = typeof import('../src/core');
type VideoExporter = typeof import('../src/platform/browser/export/videoExporter');
type Renderer = typeof import('../src/platform/browser/artworkRenderer');
type Encoder = typeof import('../src/platform/browser/export/webCodecsEncoder');

test.beforeEach(async ({ page }) => trackWorkers(page));

/** Checks the demuxed file: even size, 30 fps, one frame per plan entry, expected duration. */
async function expectVideo(buffer: Buffer, size: [number, number], durationS: number) {
  const v = await probeVideo(buffer);
  expect([v.width, v.height]).toEqual(size);
  expect(v.width % 2 + v.height % 2).toBe(0);
  expect(v.frames).toBe(durationS * 30 + 1);
  expect(v.lastTimestampS).toBeCloseTo(durationS, 3);
  expect(v.durationS).toBeCloseTo(durationS + 1 / 30, 2);
  return v;
}

test('video export with progress: 1080p, 5 s, black, Balanced — no new analysis or path', async ({ page }) => {
  test.setTimeout(180_000);
  await createArtwork(page, { width: 900, height: 700 });
  await goToExport(page);
  const paths = await workers(page, 'pathGeneration');
  await videoPanel(page).getByRole('radio', { name: '5 s', exact: true }).click();
  await expect(page.getByTestId('video-export-size')).toHaveText('1388 × 1080 px · 30 fps · 5 s');
  await expect(page.getByRole('button', { name: 'Video exportieren' })).toBeEnabled();

  await page.getByRole('button', { name: 'Video exportieren' }).click();
  // Progress in the UI ("Video wird erstellt … 47 %") with a cancel button.
  await expect(page.getByTestId('export-status')).toContainText(/Video wird erstellt … \d+ %/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Abbrechen' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Exportfortschritt' })).toBeVisible();
  const file = await exportAndDownload(page, 'Video');
  expect(file.fileName).toMatch(/^OneLine_\d{4}-\d{2}-\d{2}_\d{4}\.(mp4|webm)$/);
  expect(file.buffer.length).toBeGreaterThan(10_000);
  const v = await expectVideo(file.buffer, [1388, 1080], 5);
  // The extension matches the real container.
  expect(file.fileName.endsWith('.mp4') ? v.mimeType.startsWith('video/mp4') : v.mimeType.startsWith('video/webm')).toBe(true);
  expect(await workers(page, 'analysis')).toBe(1);
  expect(await workers(page, 'pathGeneration')).toBe(paths);
});

for (const [detail, display] of [
  ['Minimal', 'Farbe'],
  ['Detail', 'Schwarz'],
  ['Detail', 'Farbe'],
] as const) {
  test(`video: ${detail}, ${display}`, async ({ page }) => {
    test.setTimeout(180_000);
    await createArtwork(page, { width: 800, height: 800 }, { detail });
    await goToExport(page);
    const paths = await workers(page, 'pathGeneration');
    await videoPanel(page).getByRole('radio', { name: '5 s', exact: true }).click();
    await videoPanel(page).getByRole('radio', { name: display }).click();
    const file = await exportAndDownload(page, 'Video');
    await expectVideo(file.buffer, [1080, 1080], 5);
    expect(await workers(page, 'pathGeneration')).toBe(paths);
    expect(await workers(page, 'analysis')).toBe(1);
  });
}

test('video can be cancelled; nothing is offered afterwards', async ({ page }) => {
  test.setTimeout(180_000);
  await createArtwork(page, { width: 900, height: 700 });
  await goToExport(page);
  await videoPanel(page).getByRole('radio', { name: '30 s' }).click();
  await videoPanel(page).getByRole('radio', { name: '2048 px' }).click();
  await page.getByRole('button', { name: 'Video exportieren' }).click();
  await expect(page.getByTestId('export-status')).toContainText(/Video wird erstellt … \d+ %/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(exportScreen(page)).toHaveAttribute('data-export-status', 'cancelled');
  await expect(page.getByTestId('export-status')).toContainText('Export abgebrochen');
  await page.waitForTimeout(1500);
  await expect(exportScreen(page)).toHaveAttribute('data-export-status', 'cancelled');
  await expect(page.getByTestId('export-ready')).toHaveCount(0);
  // A new export works after cancelling.
  await videoPanel(page).getByRole('radio', { name: '5 s', exact: true }).click();
  await videoPanel(page).getByRole('radio', { name: '1080p' }).click();
  const file = await exportAndDownload(page, 'Video');
  await expectVideo(file.buffer, [1388, 1080], 5);
});

test('without WebCodecs the video export is disabled with a clear message', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    delete (window as { VideoEncoder?: unknown }).VideoEncoder;
  });
  await createArtwork(page, { width: 800, height: 600 });
  await goToExport(page);
  await expect(page.getByTestId('video-unsupported')).toContainText('Dieser Browser kann keine Videos erstellen');
  await expect(page.getByRole('button', { name: 'Video exportieren' })).toBeDisabled();
  // Image export is unaffected.
  await expect(page.getByRole('button', { name: 'Bild exportieren' })).toBeEnabled();
});

/**
 * Frames before encoding: deterministic times, progress and pixels; the last
 * frame equals the static artwork pixel for pixel; inputs stay untouched.
 */
test('video frames are deterministic and the last frame equals the static artwork', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const core: Core = await import('/src/core/index.ts' as string);
    const { exportCreationVideo }: VideoExporter = await import('/src/platform/browser/export/videoExporter.ts' as string);
    const { renderArtworkSurface }: Renderer = await import('/src/platform/browser/artworkRenderer.ts' as string);
    const width = 400, height = 300;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set(i % width < width / 2 ? [210, 40, 40, 255] : [40, 40, 210, 255], i * 4);
    const photo = new OffscreenCanvas(width, height);
    photo.getContext('2d')!.putImageData(new ImageData(data.slice(), width, height), 0, 0);
    const bitmap = await createImageBitmap(photo);
    const coords: number[] = [];
    let seed = 3;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 500; i++) coords.push(10 + rand() * 380, 10 + ((i * 0.55) % 280));
    const path = { coords: new Float32Array(coords), bounds: { width, height }, meta: { generatorId: 't', generatorVersion: '1', seed: 1 } };
    const before = { coords: path.coords.slice(), data: data.slice() };

    // Recording encoder: hashes every frame exactly as the real encoder would receive it.
    const record = async (colorMode: 'monochrome' | 'sampled-color', background: 'white' | 'original') => {
      const hashes: number[] = [];
      const times: number[] = [];
      let last: Uint8ClampedArray | null = null;
      let size = { width: 0, height: 0 };
      const encoder: Encoder['webCodecsEncoder'] = {
        probe: async () => ({ supported: true, codec: 'test', container: 'test', mimeType: 'video/test', extension: 'bin' }),
        async open(config) {
          size = config.size;
          const ctx = new OffscreenCanvas(config.size.width, config.size.height).getContext('2d')! as unknown as CanvasRenderingContext2D;
          return {
            ctx,
            async addFrame(t) {
              const px = ctx.getImageData(0, 0, size.width, size.height).data;
              let h = 2166136261;
              for (let i = 0; i < px.length; i += 7) h = Math.imul(h ^ px[i]!, 16777619);
              hashes.push(h >>> 0);
              times.push(t);
              last = px;
            },
            finish: async () => ({ data: new Blob(['x']), sizeBytes: 1, mimeType: 'video/test' }),
            cancel: async () => {},
          };
        },
      };
      const render = core.sanitizeRenderSettings({ colorMode, background, lineWidth: 2 }).value;
      const source = { path, render, image: { width, height, data }, backgroundImage: bitmap, originalSize: { width: 4000, height: 3000 } };
      await exportCreationVideo({ source, settings: { durationMs: 5000, fps: 30, resolution: '1080p' }, encoder });
      const still = renderArtworkSurface({ path, settings: render, longEdge: Math.max(size.width, size.height), image: { width, height, data }, backgroundImage: bitmap });
      const ref = (still.surface.ctx as unknown as CanvasRenderingContext2D).getImageData(0, 0, size.width, size.height).data;
      let maxDiff = 0;
      for (let i = 0; i < ref.length; i++) maxDiff = Math.max(maxDiff, Math.abs(ref[i]! - last![i]!));
      return { hashes, times, size, maxDiff, distinct: new Set(hashes).size };
    };

    const out = [];
    for (const [mode, bg] of [
      ['monochrome', 'white'],
      ['sampled-color', 'white'],
      ['sampled-color', 'original'],
    ] as const) {
      const a = await record(mode, bg);
      const b = await record(mode, bg);
      out.push({ mode, bg, same: a.hashes.join() === b.hashes.join(), times: a.times, size: a.size, maxDiff: a.maxDiff, frames: a.hashes.length, distinct: a.distinct });
    }
    const plan = core.planVideoFrames({ durationMs: 5000, fps: 30 });
    const unchanged = before.coords.every((v, i) => v === path.coords[i]) && before.data.every((v, i) => v === data[i]);
    return { out, planTimes: plan.timesMs, unchanged };
  });
  for (const o of r.out) {
    expect(o.same, `${o.mode}/${o.bg}`).toBe(true);
    expect(o.times).toEqual(r.planTimes);
    expect(o.frames).toBe(151);
    expect(o.distinct).toBeGreaterThan(140); // the drawing really grows frame by frame
    expect(o.size).toEqual({ width: 1440, height: 1080 });
    expect(o.maxDiff, `${o.mode}/${o.bg}`).toBe(0);
  }
  expect(r.unchanged).toBe(true);
});

test('every duration preset (5/10/15/30 s) encodes with the real encoder at 30 fps', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  const files = await page.evaluate(async () => {
    const core: Core = await import('/src/core/index.ts' as string);
    const { exportCreationVideo }: VideoExporter = await import('/src/platform/browser/export/videoExporter.ts' as string);
    const width = 320, height = 240;
    const coords: number[] = [];
    for (let i = 0; i < 300; i++) coords.push(10 + ((i * 53) % 300), 10 + ((i * 0.7) % 220));
    const path = { coords: new Float32Array(coords), bounds: { width, height }, meta: { generatorId: 't', generatorVersion: '1', seed: 1 } };
    const source = { path, render: core.DEFAULT_RENDER_SETTINGS, image: { width, height, data: new Uint8ClampedArray(width * height * 4) }, backgroundImage: null, originalSize: { width, height } };
    const out: { durationMs: number; base64: string; timings: object }[] = [];
    for (const durationMs of [5000, 10000, 15000, 30000]) {
      const file = await exportCreationVideo({ source, settings: { durationMs, fps: 30, resolution: '1080p' } });
      const bytes = new Uint8Array(await file.data.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      out.push({ durationMs, base64: btoa(binary), timings: file.timings });
    }
    return out;
  });
  for (const f of files) await expectVideo(Buffer.from(f.base64, 'base64'), [1440, 1080], f.durationMs / 1000);
});
