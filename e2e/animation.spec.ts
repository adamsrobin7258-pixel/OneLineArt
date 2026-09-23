import { expect, test, type Page } from '@playwright/test';
import { createImage, pickFile } from './helpers';

type Core = typeof import('../src/core');
type Animator = typeof import('../src/platform/browser/animation/artworkAnimator');
type Renderer = typeof import('../src/platform/browser/artworkRenderer');

const settings = (page: Page) => page.getByTestId('settings-screen');
const screen = (page: Page) => page.getByTestId('animation-screen');
const canvas = (page: Page) => page.getByTestId('animation-canvas');
const progress = async (page: Page) => Number(await canvas(page).getAttribute('data-progress'));
const workers = (page: Page, name: string) => page.evaluate((n) => (window as unknown as { __workers: string[] }).__workers.filter((u) => u.includes(n)).length, name);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __workers: string[] };
    w.__workers = [];
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        w.__workers.push(String(url));
      }
    } as typeof Worker;
  });
});

/** Import → analysis → drawing (optionally another detail level) → animation screen. */
async function openAnimation(page: Page, image: { width: number; height: number }, detail?: string, url = '/') {
  await page.goto(url);
  await pickFile(page, 'Bild auswählen', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await createImage(page, { ...image, layout: 'left-right' }) });
  await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  if (detail) await page.getByRole('radio', { name: detail }).click();
  await expect(settings(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(screen(page)).toBeVisible();
  await expect(canvas(page)).toHaveAttribute('data-status', 'ready');
}

/** Share of dark (line) pixels on the animation canvas. */
const inkShare = (page: Page) =>
  canvas(page).evaluate((c: HTMLCanvasElement) => {
    const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    let ink = 0;
    for (let i = 0; i < data.length; i += 16) if (data[i]! + data[i + 1]! + data[i + 2]! < 600) ink++;
    return ink / (data.length / 16);
  });

test('play, pause, resume, replay and finish the drawing of the same path', async ({ page }) => {
  test.setTimeout(120_000);
  await openAnimation(page, { width: 900, height: 700 });
  const analyses = await workers(page, 'analysis');
  const paths = await workers(page, 'pathGeneration');
  await page.getByRole('radio', { name: '5 s', exact: true }).click();
  expect(await progress(page)).toBe(0);
  expect(await inkShare(page)).toBe(0); // nothing drawn yet

  // Play → progress grows along the line
  await page.getByRole('button', { name: 'Abspielen' }).click();
  await expect(canvas(page)).toHaveAttribute('data-status', 'playing');
  await expect.poll(() => progress(page)).toBeGreaterThan(0.1);
  expect(await inkShare(page)).toBeGreaterThan(0);

  // Pause keeps the position
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(canvas(page)).toHaveAttribute('data-status', 'paused');
  const paused = await progress(page);
  await page.waitForTimeout(500);
  expect(await progress(page)).toBe(paused);
  await expect(page.getByRole('progressbar', { name: 'Fortschritt' })).toHaveAttribute('aria-valuenow', String(Math.round(paused * 100)));

  // Resume continues from there
  await page.getByRole('button', { name: 'Abspielen' }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(paused);

  // Replay starts at 0 again
  await page.getByRole('button', { name: 'Von vorn' }).click();
  await expect.poll(() => progress(page)).toBeLessThan(paused);

  // Runs to exactly 100 % and stops
  await expect(canvas(page)).toHaveAttribute('data-status', 'finished', { timeout: 15_000 });
  expect(await progress(page)).toBe(1);
  await expect(page.locator('.player__time')).toHaveText('0:05 / 0:05');

  // Nothing was analysed or generated again while animating
  expect(await workers(page, 'analysis')).toBe(analyses);
  expect(await workers(page, 'pathGeneration')).toBe(paths);
});

test('black and colour animate without a new path; colour shows coloured line pixels', async ({ page }) => {
  test.setTimeout(120_000);
  await openAnimation(page, { width: 800, height: 600 });
  const paths = await workers(page, 'pathGeneration');
  const colourful = () =>
    canvas(page).evaluate((c: HTMLCanvasElement) => {
      const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
      let line = 0, coloured = 0;
      for (let i = 0; i < data.length; i += 12) {
        const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
        if (r + g + b > 600) continue;
        line++;
        if (Math.max(r, g, b) - Math.min(r, g, b) > 40) coloured++;
      }
      return line ? coloured / line : 0;
    });

  await page.getByRole('radio', { name: '5 s', exact: true }).click();
  await page.getByRole('button', { name: 'Abspielen' }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0.3);
  expect(await colourful()).toBeLessThan(0.02);

  // Switching to colour while playing keeps the position and keeps playing
  const before = await progress(page);
  await page.getByRole('radio', { name: 'Farbe' }).click();
  await expect(canvas(page)).toHaveAttribute('data-status', 'playing');
  expect(await progress(page)).toBeGreaterThanOrEqual(before);
  await expect.poll(colourful).toBeGreaterThan(0.3);
  await expect(canvas(page)).toHaveAttribute('data-status', 'finished', { timeout: 15_000 });
  expect(await colourful()).toBeGreaterThan(0.3);
  expect(await workers(page, 'pathGeneration')).toBe(paths);
  expect(await workers(page, 'analysis')).toBe(1);
});

for (const detail of ['Minimal', 'Detail'] as const) {
  test(`detail level ${detail} animates to the end`, async ({ page }) => {
    test.setTimeout(120_000);
    await openAnimation(page, { width: 800, height: 600 }, detail);
    await page.getByRole('radio', { name: '5 s', exact: true }).click();
    await page.getByRole('button', { name: 'Abspielen' }).click();
    await expect(canvas(page)).toHaveAttribute('data-status', 'finished', { timeout: 15_000 });
    expect(await inkShare(page)).toBeGreaterThan(0.01);
  });
}

for (const [name, width, height, expected] of [
  ['portrait', 600, 800, [1536, 2048]],
  ['landscape', 1600, 900, [2048, 1152]],
  ['square', 700, 700, [2048, 2048]],
] as const) {
  test(`${name}: frames keep the artwork size and aspect ratio`, async ({ page }) => {
    test.setTimeout(120_000);
    await openAnimation(page, { width, height });
    const size = await canvas(page).evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
    expect(size).toEqual(expected);
    const box = (await canvas(page).boundingBox())!;
    expect(box.width / box.height).toBeCloseTo(expected[0] / expected[1], 1);
  });
}

test('developer view shows animation metrics', async ({ page }) => {
  test.setTimeout(120_000);
  await openAnimation(page, { width: 800, height: 600 }, undefined, '/?debug=analysis');
  await page.getByRole('radio', { name: '5 s', exact: true }).click();
  await page.getByRole('button', { name: 'Abspielen' }).click();
  await expect(canvas(page)).toHaveAttribute('data-status', 'finished', { timeout: 15_000 });
  const metrics = page.getByTestId('animation-metrics');
  await expect(metrics).toContainText('Dauer 0:05');
  await expect(metrics).toContainText('Fortschritt 100.0 %');
  await expect(metrics).toContainText('fps');
  await expect(metrics).toContainText('ausgelassen');
  await expect(metrics).toContainText('Render');
  const [visible, total] = (await metrics.textContent())!.match(/sichtbar (\d+) \/ (\d+) px/)!.slice(1).map(Number);
  expect(visible).toBe(total);
});

/**
 * Renderer reuse at pixel level: the last frame equals the static artwork,
 * and the animation leaves path and working image untouched.
 */
test('final frame equals the static artwork for all modes and backgrounds', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const core: Core = await import('/src/core/index.ts' as string);
    const { createArtworkAnimator }: Animator = await import('/src/platform/browser/animation/artworkAnimator.ts' as string);
    const { renderArtwork }: Renderer = await import('/src/platform/browser/artworkRenderer.ts' as string);
    const width = 400, height = 300;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const left = i % width < width / 2;
      data.set(left ? [220, 30, 30, 255] : [30, 30, 220, 255], i * 4);
    }
    const image = { width, height, data };
    const photo = new OffscreenCanvas(width, height);
    photo.getContext('2d')!.putImageData(new ImageData(data.slice(), width, height), 0, 0);
    const bitmap = await createImageBitmap(photo);
    // Deterministic winding path with uneven segment lengths.
    const coords: number[] = [];
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 600; i++) coords.push(20 + rand() * 360, 20 + ((i * 0.45) % 260));
    const path = { coords: new Float32Array(coords), bounds: { width, height }, meta: { generatorId: 'test', generatorVersion: '1', seed: 1 } };
    const before = { coords: path.coords.slice(), data: data.slice() };

    const out: { mode: string; background: string; maxDiff: number; meanDiff: number }[] = [];
    for (const colorMode of ['monochrome', 'sampled-color'] as const) {
      for (const background of ['white', 'original'] as const) {
        const settings = core.sanitizeRenderSettings({ colorMode, background, lineWidth: 2 }).value;
        const request = { path, settings, longEdge: 800, image, backgroundImage: bitmap };
        const still = await renderArtwork(request);
        const animator = createArtworkAnimator(request);
        const target = new OffscreenCanvas(animator.size.width, animator.size.height).getContext('2d')! as unknown as CanvasRenderingContext2D;
        for (let f = 0; f <= 30; f++) animator.renderAt(target, f / 30);
        const a = target.getImageData(0, 0, animator.size.width, animator.size.height).data;
        const ref = new OffscreenCanvas(animator.size.width, animator.size.height).getContext('2d')!;
        ref.drawImage(still.image, 0, 0);
        const b = ref.getImageData(0, 0, animator.size.width, animator.size.height).data;
        let max = 0, sum = 0;
        for (let i = 0; i < a.length; i++) {
          const d = Math.abs(a[i]! - b[i]!);
          sum += d;
          if (d > max) max = d;
        }
        out.push({ mode: colorMode, background, maxDiff: max, meanDiff: sum / a.length });
        animator.dispose();
      }
    }
    const unchanged = before.coords.every((v, i) => v === path.coords[i]) && before.data.every((v, i) => v === data[i]);
    return { out, unchanged };
  });
  expect(results.unchanged).toBe(true);
  for (const r of results.out) {
    // Same background surface + same line strokes as the static render → identical pixels.
    expect(r.maxDiff, `${r.mode}/${r.background}`).toBe(0);
    expect(r.meanDiff, `${r.mode}/${r.background}`).toBeLessThan(0.05);
  }
});
