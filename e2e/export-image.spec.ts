import { expect, test } from '@playwright/test';
import {
  colourfulness,
  createArtwork,
  exportAndDownload,
  exportScreen,
  goToExport,
  imageDimensions,
  imagePanel,
  trackWorkers,
  workers,
} from './exportHelpers';

type Core = typeof import('../src/core');
type ImageExporter = typeof import('../src/platform/browser/export/imageExporter');

test.beforeEach(async ({ page }) => trackWorkers(page));

for (const [name, width, height, res, expected] of [
  ['landscape', 1600, 900, '2048 px', [2048, 1152]],
  ['portrait', 600, 800, '4096 px', [3072, 4096]],
  ['square', 700, 700, 'Original', [700, 700]],
] as const) {
  test(`${name}: PNG at ${res} has the exact size and aspect ratio`, async ({ page }) => {
    test.setTimeout(120_000);
    await createArtwork(page, { width, height });
    await goToExport(page);
    const paths = await workers(page, 'pathGeneration');
    await imagePanel(page).getByRole('radio', { name: res, exact: true }).click();
    await expect(page.getByTestId('image-export-size')).toHaveText(`${expected[0]} × ${expected[1]} px`);
    const file = await exportAndDownload(page, 'Bild');
    expect(file.fileName).toMatch(/^OneLine_\d{4}-\d{2}-\d{2}_\d{4}\.png$/);
    expect(file.buffer.length).toBeGreaterThan(1000);
    expect(imageDimensions(file.buffer)).toEqual({ format: 'png', width: expected[0], height: expected[1] });
    // Export = renderer on the existing path: no new analysis, no new path.
    expect(await workers(page, 'analysis')).toBe(1);
    expect(await workers(page, 'pathGeneration')).toBe(paths);
  });
}

test('JPEG export; switching resolutions never recomputes the path', async ({ page }) => {
  test.setTimeout(120_000);
  await createArtwork(page, { width: 900, height: 600 });
  await goToExport(page);
  const paths = await workers(page, 'pathGeneration');
  await imagePanel(page).getByRole('radio', { name: 'JPEG' }).click();
  for (const [res, expected] of [
    ['2048 px', [2048, 1365]],
    ['4096 px', [4096, 2731]],
    ['Original', [900, 600]],
  ] as const) {
    await imagePanel(page).getByRole('radio', { name: res, exact: true }).click();
    const file = await exportAndDownload(page, 'Bild');
    expect(file.fileName).toMatch(/\.jpg$/);
    expect(imageDimensions(file.buffer)).toEqual({ format: 'jpeg', width: expected[0], height: expected[1] });
  }
  expect(await workers(page, 'pathGeneration')).toBe(paths);
  expect(await workers(page, 'analysis')).toBe(1);
});

test('black and colour; detail levels Minimal and Detail', async ({ page }) => {
  test.setTimeout(180_000);
  await createArtwork(page, { width: 800, height: 600 }, { detail: 'Minimal' });
  await goToExport(page);
  await imagePanel(page).getByRole('radio', { name: '2048 px', exact: true }).click();
  const black = await exportAndDownload(page, 'Bild');
  const blackStats = await colourfulness(page, black.buffer, 'image/png');
  expect(blackStats.coloured).toBeLessThan(0.02);
  expect(blackStats.line).toBeGreaterThan(0.005);

  await page.getByRole('group', { name: 'Video' }).getByRole('radio', { name: 'Foto' }).click();
  const colour = await exportAndDownload(page, 'Bild');
  expect((await colourfulness(page, colour.buffer, 'image/png')).coloured).toBeGreaterThan(0.3);

  // Detail level: set in the settings, export again (the new level has more line).
  await page.getByRole('button', { name: 'Zurück' }).click();
  await page.getByRole('button', { name: 'Zurück' }).click();
  await page.getByRole('radio', { name: 'Detail' }).click();
  await expect(page.getByTestId('settings-screen')).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
  await page.getByRole('radio', { name: 'Einfarbig' }).click();
  await goToExport(page);
  await imagePanel(page).getByRole('radio', { name: '2048 px', exact: true }).click();
  const detail = await exportAndDownload(page, 'Bild');
  expect(imageDimensions(detail.buffer)).toMatchObject({ width: 2048, height: 1536 });
  expect((await colourfulness(page, detail.buffer, 'image/png')).line).toBeGreaterThan(blackStats.line);
});

test('export status is shown while exporting 4096 px', async ({ page }) => {
  test.setTimeout(120_000);
  await createArtwork(page, { width: 1600, height: 1200 }, { detail: 'Detail' });
  await goToExport(page);
  const statuses = new Set<string>();
  const poll = setInterval(() => void exportScreen(page).getAttribute('data-export-status').then((s) => s && statuses.add(s)).catch(() => {}), 5);
  await page.getByRole('button', { name: 'Bild exportieren' }).click();
  await expect(exportScreen(page)).toHaveAttribute('data-export-status', 'ready', { timeout: 60_000 });
  clearInterval(poll);
  expect([...statuses].some((s) => ['preparing', 'rendering', 'encoding'].includes(s))).toBe(true);
  await expect(page.getByTestId('export-ready')).toContainText('Fertig: OneLine_');
});

/**
 * Renderer level: same path at 2048 / 4096 / original background; line width
 * scales with the size, the original background shows the photo, repeated
 * exports are identical and nothing of the input changes.
 */
test('image exporter: relative line width, original background, determinism, originals untouched', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const core: Core = await import('/src/core/index.ts' as string);
    const { exportArtworkImage }: ImageExporter = await import('/src/platform/browser/export/imageExporter.ts' as string);
    const width = 400, height = 300;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set(i % width < width / 2 ? [200, 40, 40, 255] : [40, 40, 200, 255], i * 4);
    const photo = new OffscreenCanvas(width, height);
    photo.getContext('2d')!.putImageData(new ImageData(data.slice(), width, height), 0, 0);
    const bitmap = await createImageBitmap(photo);
    const coords: number[] = [];
    for (let i = 0; i < 400; i++) coords.push(20 + ((i * 37) % 360), 20 + ((i * 0.6) % 260));
    const path = { coords: new Float32Array(coords), bounds: { width, height }, meta: { generatorId: 't', generatorVersion: '1', seed: 1 } };
    const before = { coords: path.coords.slice(), data: data.slice() };
    const source = (render: Partial<import('../src/core').RenderSettings>) => ({
      path,
      render: core.sanitizeRenderSettings(render).value,
      image: { width, height, data },
      backgroundImage: bitmap,
      originalSize: { width: 4000, height: 3000 },
    });
    const pixels = async (blob: Blob) => {
      const b = await createImageBitmap(blob);
      const c = new OffscreenCanvas(b.width, b.height).getContext('2d')!;
      c.drawImage(b, 0, 0);
      return { w: b.width, h: b.height, data: c.getImageData(0, 0, b.width, b.height).data };
    };
    const ink = (p: { data: Uint8ClampedArray }) => {
      let dark = 0;
      for (let i = 0; i < p.data.length; i += 4) if (p.data[i]! < 128) dark++;
      return dark / (p.data.length / 4);
    };
    const at2048 = await pixels((await exportArtworkImage({ source: source({}), settings: { resolution: '2048' } })).data);
    const at4096 = await pixels((await exportArtworkImage({ source: source({}), settings: { resolution: '4096' } })).data);
    const again = await pixels((await exportArtworkImage({ source: source({}), settings: { resolution: '2048' } })).data);
    const original = await exportArtworkImage({ source: source({}), settings: { resolution: 'original' } });
    const bg = await pixels((await exportArtworkImage({ source: source({ background: 'original' }), settings: { resolution: '2048', format: 'jpeg' } })).data);
    const transparentJpeg = await pixels((await exportArtworkImage({ source: source({ background: 'transparent' }), settings: { resolution: '2048', format: 'jpeg' } })).data);
    const px = (p: { w: number; data: Uint8ClampedArray }, x: number, y: number) => [...p.data.slice((y * p.w + x) * 4, (y * p.w + x) * 4 + 3)];
    let cancelled = '';
    const abort = new AbortController();
    abort.abort();
    await exportArtworkImage({ source: source({}), settings: {}, signal: abort.signal }).catch((e: { code: string }) => (cancelled = e.code));
    return {
      sizes: [at2048.w, at2048.h, at4096.w, at4096.h],
      originalSize: [original.sizeBytes > 0, original.fileName],
      ink2048: ink(at2048),
      ink4096: ink(at4096),
      identical: at2048.data.every((v, i) => v === again.data[i]),
      bgLeft: px(bg, 5, 5),
      bgRight: px(bg, 2040, 5),
      transparentJpegCorner: px(transparentJpeg, 1, 1),
      cancelled,
      unchanged: before.coords.every((v, i) => v === path.coords[i]) && before.data.every((v, i) => v === data[i]),
    };
  });
  expect(r.sizes).toEqual([2048, 1536, 4096, 3072]);
  // Normalized line width: the share of ink stays the same at double resolution.
  expect(r.ink4096 / r.ink2048).toBeGreaterThan(0.85);
  expect(r.ink4096 / r.ink2048).toBeLessThan(1.15);
  expect(r.identical).toBe(true);
  expect(r.originalSize[0]).toBe(true);
  // Original background: the photo (red left, blue right) behind the line.
  expect(r.bgLeft[0]!).toBeGreaterThan(150);
  expect(r.bgLeft[2]!).toBeLessThan(90);
  expect(r.bgRight[2]!).toBeGreaterThan(150);
  // JPEG has no alpha: transparent becomes white, not black.
  expect(Math.min(...r.transparentJpegCorner)).toBeGreaterThan(240);
  expect(r.cancelled).toBe('cancelled');
  expect(r.unchanged).toBe(true);
});
