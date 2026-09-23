import { expect, test, type Page } from '@playwright/test';
import { createImage, pickFile } from './helpers';
import { createArtwork, exportAndDownload, exportScreen, goToExport, imageDimensions, imagePanel, probeVideo, settingsScreen, trackWorkers, videoPanel, workers } from './exportHelpers';

type ImageExporter = typeof import('../src/platform/browser/export/imageExporter');
type Core = typeof import('../src/core');

/** Console errors and uncaught exceptions of the page (normal flow must have none). */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test.beforeEach(async ({ page }) => trackWorkers(page));

const saveButton = (page: Page) => page.getByTestId('save-project');
const canvas = (page: Page) => page.getByTestId('animation-canvas');

/** Hash of the stored path of every project (read straight from IndexedDB). */
const storedPathHashes = (page: Page) =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open('one-line-art');
      req.onsuccess = () => resolve(req.result);
    });
    const all = await new Promise<{ coords: Float32Array }[]>((resolve) => {
      const req = db.transaction('paths').objectStore('paths').getAll();
      req.onsuccess = () => resolve(req.result as { coords: Float32Array }[]);
    });
    db.close();
    return all.map(({ coords }) => {
      let h = 2166136261;
      const u = new Uint32Array(coords.buffer, coords.byteOffset, coords.length);
      for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i]!, 16777619);
      return h >>> 0;
    });
  });

test('complete user flow without console errors: new work → animation → exports → save → reopen', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await page.goto('/');
  await pickFile(page, 'Bild auswählen', { name: 'Urlaub.jpg', mimeType: 'image/jpeg', buffer: await createImage(page, { width: 1200, height: 900, layout: 'left-right' }) });
  await expect(page.getByTestId('image-viewer')).toBeVisible();
  await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
  await page.getByRole('radio', { name: 'Detail' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
  await page.getByRole('radio', { name: 'Foto' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-rendered-mode', 'sampled-color');
  await page.getByRole('radio', { name: 'Einfarbig' }).click();
  expect(await workers(page, 'analysis')).toBe(1);
  expect(await workers(page, 'pathGeneration')).toBe(2);

  // Preview: play, pause, resume, restart, end + final hold.
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('radio', { name: '5 s', exact: true }).click();
  await page.getByRole('button', { name: 'Abspielen' }).click();
  await expect.poll(async () => Number(await canvas(page).getAttribute('data-progress'))).toBeGreaterThan(0.2);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(canvas(page)).toHaveAttribute('data-status', 'paused');
  await page.getByRole('button', { name: 'Abspielen' }).click();
  await page.getByRole('button', { name: 'Von vorn' }).click();
  await expect(canvas(page)).toHaveAttribute('data-phase', 'hold', { timeout: 10_000 });
  await expect(canvas(page)).toHaveAttribute('data-status', 'finished', { timeout: 5_000 });

  // Export image and video.
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(exportScreen(page)).toBeVisible();
  const png = await exportAndDownload(page, 'Bild');
  expect(imageDimensions(png.buffer)).toEqual({ format: 'png', width: 4096, height: 3072 });
  await videoPanel(page).getByRole('radio', { name: '5 s', exact: true }).click();
  const video = await exportAndDownload(page, 'Video');
  const probe = await probeVideo(video.buffer);
  expect(probe.frames).toBe(7 * 30 + 1);

  // Save → gallery → open: same drawing, no analysis, no path computation.
  await saveButton(page).click();
  await expect(saveButton(page)).toHaveText('Gespeichert');
  await page.getByRole('button', { name: 'Meine Werke' }).click();
  await page.getByTestId('gallery-item').first().getByRole('button', { name: /öffnen/ }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready');
  await expect(settingsScreen(page)).toHaveAttribute('data-detail-level', 'detail');
  expect(await workers(page, 'analysis')).toBe(1);
  expect(await workers(page, 'pathGeneration')).toBe(2);
  expect(errors).toEqual([]);
});

test('save status: open → Gespeichert, change → Speichern, save, gallery and back, reload', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await createArtwork(page, { width: 900, height: 600 });
  await saveButton(page).click();
  await expect(saveButton(page)).toHaveText('Gespeichert');
  await page.getByRole('button', { name: 'Meine Werke' }).click();
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(saveButton(page)).toHaveText('Gespeichert');
  await page.getByRole('radio', { name: 'Foto' }).click();
  await expect(saveButton(page)).toHaveText('Speichern');
  await saveButton(page).click();
  await expect(saveButton(page)).toHaveText('Gespeichert');

  await page.reload();
  await page.getByRole('button', { name: 'Meine Werke' }).click();
  await expect(page.getByTestId('gallery-item')).toHaveCount(1); // updated, not duplicated
  await page.getByTestId('gallery-item').first().getByRole('button', { name: /öffnen/ }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-rendered-mode', 'sampled-color');
  await expect(saveButton(page)).toHaveText('Gespeichert');
  await page.getByRole('button', { name: 'Meine Werke' }).click();
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(saveButton(page)).toHaveText('Gespeichert');
  expect(errors).toEqual([]);
});

test('the path never changes: colour, animation, image and video export, saving and reopening', async ({ page }) => {
  test.setTimeout(240_000);
  await createArtwork(page, { width: 900, height: 700 });
  await saveButton(page).click();
  await expect(saveButton(page)).toHaveText('Gespeichert');
  const [original] = await storedPathHashes(page);

  await page.getByRole('radio', { name: 'Foto' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Abspielen' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Weiter' }).click();
  await imagePanel(page).getByRole('radio', { name: '2048 px', exact: true }).click();
  await exportAndDownload(page, 'Bild');
  await videoPanel(page).getByRole('radio', { name: '5 s', exact: true }).click();
  await exportAndDownload(page, 'Video');
  await saveButton(page).click();
  await expect(saveButton(page)).toHaveText('Gespeichert');
  expect(await storedPathHashes(page)).toEqual([original]);

  await page.reload();
  await page.getByRole('button', { name: 'Meine Werke' }).click();
  await page.getByTestId('gallery-item').first().getByRole('button', { name: /öffnen/ }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready');
  await page.getByRole('radio', { name: 'Einfarbig' }).click();
  await saveButton(page).click();
  await expect(saveButton(page)).toHaveText('Gespeichert');
  expect(await storedPathHashes(page)).toEqual([original]);
  expect(await workers(page, 'pathGeneration')).toBe(0);
});

test('two works from the same photo share one stored original; it goes with the last one', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  const file = { name: 'same.jpg', mimeType: 'image/jpeg', buffer: await createImage(page, { width: 800, height: 600, layout: 'left-right' }) };
  const count = (store: string) =>
    page.evaluate(async (s) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const req = indexedDB.open('one-line-art');
        req.onsuccess = () => resolve(req.result);
      });
      const n = await new Promise<number>((resolve) => {
        const req = db.transaction(s).objectStore(s).count();
        req.onsuccess = () => resolve(req.result);
      });
      db.close();
      return n;
    }, store);
  for (const [i, level] of ['Balanced', 'Minimal'].entries()) {
    // Second work: back to step 1 and import the very same file again (new session, same photo).
    if (i === 1) await page.getByRole('navigation', { name: 'Ablauf' }).getByRole('button', { name: 'Bild' }).click();
    await pickFile(page, i === 0 ? 'Bild auswählen' : 'Anderes Bild', file);
    await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Weiter' }).click();
    await page.getByRole('radio', { name: level }).click();
    await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
    await saveButton(page).click();
    await expect(saveButton(page)).toHaveText('Gespeichert');
  }
  expect([await count('projects'), await count('images')]).toEqual([2, 1]);
  await page.getByRole('button', { name: 'Meine Werke' }).click();
  await page.getByTestId('gallery-item').first().getByRole('button', { name: 'Löschen' }).click();
  await page.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(page.getByTestId('gallery-item')).toHaveCount(1);
  expect([await count('projects'), await count('images')]).toEqual([1, 1]);
  // The remaining work still opens with its original.
  await page.getByTestId('gallery-item').first().getByRole('button', { name: /öffnen/ }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready');
  await page.getByRole('button', { name: 'Meine Werke' }).click();
  await page.getByTestId('gallery-item').first().getByRole('button', { name: 'Löschen' }).click();
  await page.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(page.getByTestId('gallery-empty')).toBeVisible();
  expect([await count('projects'), await count('images')]).toEqual([0, 0]);
});

test('EXIF-rotated photo: upright everywhere, original export size, stored bytes untouched', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  // 800×600 pixels stored sideways (orientation 6) → upright 600×800.
  const buffer = await createImage(page, { width: 800, height: 600, layout: 'left-right', exifOrientation: 6 });
  await pickFile(page, 'Bild auswählen', { name: 'hochkant.jpg', mimeType: 'image/jpeg', buffer });
  await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-image-size', '600x800');
  await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
  await saveButton(page).click();
  await expect(saveButton(page)).toHaveText('Gespeichert');
  await page.reload();
  await page.getByRole('button', { name: 'Meine Werke' }).click();
  await page.getByTestId('gallery-item').first().getByRole('button', { name: /öffnen/ }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready');
  await goToExport(page);
  await imagePanel(page).getByRole('radio', { name: 'Original' }).click();
  const png = await exportAndDownload(page, 'Bild');
  expect(imageDimensions(png.buffer)).toMatchObject({ width: 600, height: 800 });
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open('one-line-art');
      req.onsuccess = () => resolve(req.result);
    });
    const [image] = await new Promise<{ data: Blob }[]>((resolve) => {
      const req = db.transaction('images').objectStore('images').getAll();
      req.onsuccess = () => resolve(req.result as { data: Blob }[]);
    });
    return [...new Uint8Array(await image!.data.arrayBuffer())];
  });
  expect(Buffer.from(stored).equals(buffer)).toBe(true);
});

test('encoder failure mid-export: clear message, retry offered, no file', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const encode = VideoEncoder.prototype.encode;
    let calls = 0;
    VideoEncoder.prototype.encode = function (...args: Parameters<typeof encode>) {
      if (++calls > 20) throw new DOMException('Encoder crashed', 'EncodingError');
      return encode.apply(this, args);
    };
  });
  const errors = watchErrors(page);
  await createArtwork(page, { width: 800, height: 600 });
  await goToExport(page);
  await videoPanel(page).getByRole('radio', { name: '5 s', exact: true }).click();
  await page.getByRole('button', { name: 'Video exportieren' }).click();
  await expect(exportScreen(page)).toHaveAttribute('data-export-status', 'failed', { timeout: 60_000 });
  await expect(page.getByRole('alert')).toContainText('Die Datei konnte nicht erstellt werden');
  await expect(page.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();
  await expect(page.getByTestId('export-ready')).toHaveCount(0);
  // Only the (expected) developer log of the failure, no uncaught exception.
  expect(errors.filter((e) => !e.startsWith('video export failed'))).toEqual([]);
});

test('leaving the export screen cancels a running export; coming back is clean', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await createArtwork(page, { width: 900, height: 700 });
  await goToExport(page);
  await videoPanel(page).getByRole('radio', { name: '30 s' }).click();
  await page.getByRole('button', { name: 'Video exportieren' }).click();
  await expect(page.getByTestId('export-status')).toContainText(/Video wird erstellt … \d+ %/, { timeout: 30_000 });
  await page.getByRole('navigation', { name: 'Ablauf' }).getByRole('button', { name: 'Vorschau' }).click();
  await expect(page.getByTestId('animation-screen')).toBeVisible();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(exportScreen(page)).toHaveAttribute('data-export-status', 'idle');
  await page.waitForTimeout(1000);
  await expect(page.getByTestId('export-ready')).toHaveCount(0);
  const file = await exportAndDownload(page, 'Bild');
  expect(file.buffer.length).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});

test('image export runs in a worker, can be cancelled there, falls back to the main thread', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const core: Core = await import('/src/core/index.ts' as string);
    const { exportArtworkImage }: ImageExporter = await import('/src/platform/browser/export/imageExporter.ts' as string);
    const width = 600, height = 400;
    const data = new Uint8ClampedArray(width * height * 4).fill(200);
    const coords: number[] = [];
    for (let i = 0; i < 20000; i++) coords.push(5 + ((i * 37) % 590), 5 + ((i * 0.02) % 390));
    const path = { coords: new Float32Array(coords), bounds: { width, height }, meta: { generatorId: 't', generatorVersion: '1', seed: 1 } };
    const photo = await createImageBitmap(new ImageData(data.slice(), width, height));
    const source = (render: Partial<import('../src/core').RenderSettings>) => ({ path, render: core.sanitizeRenderSettings(render).value, image: { width, height, data }, backgroundImage: photo, originalSize: { width, height } });
    const worker = await exportArtworkImage({ source: source({ colorMode: 'sampled-color' }), settings: { resolution: '4096' } });
    const main = await exportArtworkImage({ source: source({ background: 'original' }), settings: { resolution: '2048' } });
    // Cancel while the worker renders the 4096 px image.
    const abort = new AbortController();
    const started = performance.now();
    const pending = exportArtworkImage({ source: source({}), settings: { resolution: '4096' }, signal: abort.signal, onPhase: (p) => p === 'rendering' && setTimeout(() => abort.abort(), 5) });
    const cancelled = await pending.then(() => 'finished', (e: { code: string }) => e.code);
    // Frames keep coming while the worker renders (main thread not blocked by rendering).
    let frames = 0;
    let stop = false;
    const count = () => {
      frames++;
      if (!stop) requestAnimationFrame(count);
    };
    requestAnimationFrame(count);
    const t0 = performance.now();
    await exportArtworkImage({ source: source({ colorMode: 'sampled-color' }), settings: { resolution: 'original' } }).then(() => exportArtworkImage({ source: source({}), settings: { resolution: '4096', format: 'jpeg' } }));
    stop = true;
    const elapsed = performance.now() - t0;
    return { worker: worker.timings.thread, workerType: worker.mimeType, main: main.timings.thread, cancelled, cancelMs: performance.now() - started, fps: (frames / elapsed) * 1000 };
  });
  expect(r.worker).toBe('worker');
  expect(r.workerType).toBe('image/png');
  expect(r.main).toBe('main');
  expect(r.cancelled).toBe('cancelled');
  expect(r.fps).toBeGreaterThan(20);
});

test('zooming in re-renders the preview sharper from the same path', async ({ page }) => {
  test.setTimeout(120_000);
  await createArtwork(page, { width: 900, height: 600 });
  await expect(settingsScreen(page)).toHaveAttribute('data-render-size', '2048x1365');
  const viewer = page.getByTestId('image-viewer');
  await viewer.focus();
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  await expect(settingsScreen(page)).toHaveAttribute('data-render-size', '4096x2731', { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Einpassen' })).toBeVisible(); // still zoomed
  expect(await workers(page, 'pathGeneration')).toBe(1);
  expect(await workers(page, 'analysis')).toBe(1);
});

test('going to the background pauses the preview', async ({ page }) => {
  test.setTimeout(120_000);
  await createArtwork(page, { width: 800, height: 600 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Abspielen' }).click();
  await expect(canvas(page)).toHaveAttribute('data-status', 'playing');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(canvas(page)).toHaveAttribute('data-status', 'paused');
});

test('60 fps video: 7 s timeline at 60 fps (real encoder)', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  const base64 = await page.evaluate(async () => {
    const core: Core = await import('/src/core/index.ts' as string);
    const { exportCreationVideo } = await import('/src/platform/browser/export/videoExporter.ts' as string);
    const width = 320, height = 240;
    const coords: number[] = [];
    for (let i = 0; i < 300; i++) coords.push(10 + ((i * 53) % 300), 10 + ((i * 0.7) % 220));
    const path = { coords: new Float32Array(coords), bounds: { width, height }, meta: { generatorId: 't', generatorVersion: '1', seed: 1 } };
    const source = { path, render: core.DEFAULT_RENDER_SETTINGS, image: { width, height, data: new Uint8ClampedArray(width * height * 4) }, backgroundImage: null, originalSize: { width, height } };
    const file = await exportCreationVideo({ source, settings: { durationMs: 5000, fps: 60, resolution: '1080p' } });
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  });
  const v = await probeVideo(Buffer.from(base64, 'base64'));
  expect(v.frames).toBe(7 * 60 + 1);
  expect(v.lastTimestampS).toBeCloseTo(7, 3);
});

test('iOS-like canvas limit: an oversized export fails with a clear message, smaller sizes still work', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    // iOS Safari refuses canvases above 16.7 megapixels (getContext → null). Emulate it,
    // and keep the export on the main thread where this emulation applies.
    const LIMIT = 16_777_216;
    for (const proto of [OffscreenCanvas.prototype, HTMLCanvasElement.prototype] as { getContext: (...a: unknown[]) => unknown; width?: number }[]) {
      const original = proto.getContext;
      proto.getContext = function (this: { width: number; height: number }, ...args: unknown[]) {
        return this.width * this.height > LIMIT ? null : original.apply(this, args);
      };
    }
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        if (String(url).includes('imageExport')) throw new Error('no export worker');
        super(url, options);
      }
    } as typeof Worker;
  });
  // 6000×4000 photo ("Original" = 24 MP > limit), made on a page without the emulation.
  const helper = await page.context().newPage();
  await helper.goto('/');
  const buffer = await createImage(helper, { width: 6000, height: 4000, layout: 'left-right' });
  await helper.close();
  await page.goto('/');
  await pickFile(page, 'Bild auswählen', { name: 'gross.jpg', mimeType: 'image/jpeg', buffer });
  await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
  await goToExport(page);
  await imagePanel(page).getByRole('radio', { name: 'Original' }).click();
  await page.getByRole('button', { name: 'Bild exportieren' }).click();
  await expect(exportScreen(page)).toHaveAttribute('data-export-status', 'failed', { timeout: 60_000 });
  await expect(page.getByRole('alert')).toContainText('Nicht genug Speicher für diese Größe');
  await imagePanel(page).getByRole('radio', { name: '4096 px' }).click();
  const png = await exportAndDownload(page, 'Bild');
  expect(imageDimensions(png.buffer)).toMatchObject({ width: 4096, height: 2730 });
});
