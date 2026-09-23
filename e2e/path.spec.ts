import { expect, test, type Page } from '@playwright/test';
import { createImage, pickFile } from './helpers';

const toolbar = (page: Page) => page.getByTestId('image-toolbar');
const debug = (page: Page) => page.getByTestId('analysis-debug');

async function loadAndAnalyse(page: Page, buffer: Buffer, name = 'a.jpg', button = 'Bild auswählen') {
  await pickFile(page, button, { name, mimeType: 'image/jpeg', buffer });
  await expect(toolbar(page)).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
}

async function generate(page: Page) {
  await page.getByRole('button', { name: /Pfad (neu )?berechnen/ }).click();
  await expect(debug(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
}

test.describe('One-Line path in the developer view', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?debug=analysis');
  });

  test('generates one valid path for the current image, with metrics and overlays', async ({ page }) => {
    await loadAndAnalyse(page, await createImage(page, { width: 1200, height: 900, layout: 'left-right' }));
    await generate(page);
    await expect(debug(page)).toHaveAttribute('data-path-valid', 'true');
    const imageId = await toolbar(page).getAttribute('data-image-id');
    await expect(debug(page)).toHaveAttribute('data-path-source', imageId!);

    const metrics = page.getByTestId('path-metrics');
    await expect(metrics).toContainText('importance-stipple-tour');
    await expect(metrics).toContainText('worker');
    await expect(metrics).toContainText('Gültig');
    await expect(metrics).toContainText('Selbstkreuzungen');
    await expect(metrics).toContainText('Importance-Abdeckung');

    // Overlays render the line (dark pixels on a light canvas).
    for (const name of ['Pfad', 'Pfad + Original', 'Pfad + Importance']) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect
        .poll(() =>
          page.getByTestId('image-viewer').locator('canvas').evaluate((c: HTMLCanvasElement) => {
            const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
            let dark = 0;
            for (let i = 0; i < data.length; i += 4 * 7) if (data[i]! + data[i + 1]! + data[i + 2]! < 300) dark++;
            return dark;
          }),
        )
        .toBeGreaterThan(200);
    }
  });

  test('is deterministic: recomputing gives the identical path', async ({ page }) => {
    await loadAndAnalyse(page, await createImage(page, { width: 900, height: 700, layout: 'left-right' }));
    await generate(page);
    const first = await debug(page).getAttribute('data-path-hash');
    expect(first).toMatch(/^[0-9a-f]{8}$/);
    await generate(page);
    await expect(debug(page)).toHaveAttribute('data-path-hash', first!);
  });

  test('image change discards the path; a new path belongs to the new image', async ({ page }) => {
    await loadAndAnalyse(page, await createImage(page, { width: 900, height: 700, layout: 'left-right' }));
    await generate(page);
    const firstHash = await debug(page).getAttribute('data-path-hash');

    await loadAndAnalyse(page, await createImage(page, { width: 700, height: 900, color: '#444444' }), 'b.jpg', 'Anderes Bild');
    await expect(debug(page)).toHaveAttribute('data-path-status', 'idle');
    await expect(debug(page)).toHaveAttribute('data-path-hash', '');
    await expect(page.getByTestId('path-metrics')).toHaveCount(0);

    await generate(page);
    const secondId = await toolbar(page).getAttribute('data-image-id');
    await expect(debug(page)).toHaveAttribute('data-path-source', secondId!);
    expect(await debug(page).getAttribute('data-path-hash')).not.toBe(firstHash);
  });
});

test('the normal UI does not generate or show a path yet', async ({ page }) => {
  await page.goto('/');
  await loadAndAnalyse(page, await createImage(page, { width: 800, height: 600, layout: 'left-right' }));
  await expect(page.getByRole('button', { name: /Pfad/ })).toHaveCount(0);
  await expect(page.getByTestId('path-metrics')).toHaveCount(0);
});
