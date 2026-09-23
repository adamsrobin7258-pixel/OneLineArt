import { expect, test, type Page } from '@playwright/test';
import { createImage, pickFile } from './helpers';

const settings = (page: Page) => page.getByTestId('settings-screen');
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

/** Share of coloured (non-grey) pixels among the drawn line pixels of the viewer. */
async function lineColourfulness(page: Page) {
  return page.getByTestId('image-viewer').locator('canvas').evaluate((c: HTMLCanvasElement) => {
    const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    let line = 0, coloured = 0;
    for (let i = 0; i < data.length; i += 4 * 3) {
      const [r, g, b, a] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
      if (a < 200 || r + g + b > 600) continue;
      line++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 40) coloured++;
    }
    return line ? coloured / line : 0;
  });
}

test('import → Balanced → black → colour → detail change → black, without re-analysing', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  // 1–2: import and analyse
  await pickFile(page, 'Bild auswählen', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await createImage(page, { width: 900, height: 700, layout: 'left-right' }) });
  await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  // 3–4: Balanced drawing, rendered in black
  await expect(settings(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
  await expect(settings(page)).toHaveAttribute('data-rendered-mode', 'monochrome');
  await expect(page.getByRole('radio', { name: 'Einfarbig' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => lineColourfulness(page)).toBeLessThan(0.02);
  const paths = await workers(page, 'pathGeneration');

  // 5–6: colour — only re-rendered, no new analysis, no new path
  await page.getByRole('radio', { name: 'Foto' }).click();
  await expect(settings(page)).toHaveAttribute('data-rendered-mode', 'sampled-color');
  await expect(page.getByRole('status').filter({ hasText: 'Zeichnung wird berechnet' })).toHaveCount(0);
  await expect.poll(() => lineColourfulness(page)).toBeGreaterThan(0.3);
  expect(await workers(page, 'analysis')).toBe(1);
  expect(await workers(page, 'pathGeneration')).toBe(paths);

  // 7–8: detail level change → new path, rendered in colour
  await page.getByRole('radio', { name: 'Detail' }).click();
  await expect(settings(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
  expect(await workers(page, 'pathGeneration')).toBe(paths + 1);
  await expect(settings(page)).toHaveAttribute('data-rendered-mode', 'sampled-color');

  // 9–10: back to black
  await page.getByRole('radio', { name: 'Einfarbig' }).click();
  await expect(settings(page)).toHaveAttribute('data-rendered-mode', 'monochrome');
  await expect.poll(() => lineColourfulness(page)).toBeLessThan(0.02);
  expect(await workers(page, 'analysis')).toBe(1);
  expect(await workers(page, 'pathGeneration')).toBe(paths + 1);
});

for (const [name, width, height, expected] of [
  ['portrait', 600, 800, '1536x2048'],
  ['landscape', 1600, 900, '2048x1152'],
  ['square', 700, 700, '2048x2048'],
] as const) {
  test(`${name}: the artwork keeps the photo's aspect ratio`, async ({ page }) => {
    await page.goto('/');
    await pickFile(page, 'Bild auswählen', { name: `${name}.jpg`, mimeType: 'image/jpeg', buffer: await createImage(page, { width, height, layout: 'left-right' }) });
    await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Weiter' }).click();
    await expect(settings(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
    await expect(settings(page)).toHaveAttribute('data-render-size', expected);
  });
}

test('developer view shows rendering data', async ({ page }) => {
  await page.goto('/?debug=analysis');
  await pickFile(page, 'Bild auswählen', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await createImage(page, { width: 800, height: 600, layout: 'left-right' }) });
  await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Pfad berechnen' }).click();
  await expect(page.getByTestId('analysis-debug')).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Artwork Farbe', exact: true }).click();
  const metrics = page.getByTestId('render-metrics');
  await expect(metrics).toContainText('Farbmodus sampled-color');
  await expect(metrics).toContainText('Hintergrund white');
  await expect(metrics).toContainText('2048×1536 px');
  await expect(metrics).toContainText('Farb-Sampling');
  await expect(metrics).toContainText('Renderer v');
  await expect(page.getByTestId('render-runtime')).toContainText('ms');
  await page.getByRole('button', { name: 'Artwork + Original', exact: true }).click();
  await expect(metrics).toContainText('Hintergrund original');
});
