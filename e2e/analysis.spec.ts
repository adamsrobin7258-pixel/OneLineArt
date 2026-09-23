import { expect, test, type Page } from '@playwright/test';
import { createImage, expectReady, pickFile, status } from './helpers';

const toolbar = (page: Page) => page.getByTestId('image-toolbar');
const debug = (page: Page) => page.getByTestId('analysis-debug');

async function expectAnalysisReady(page: Page) {
  await expect(toolbar(page)).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
}

/** Max brightness (0–255) in a ±`span` pixel horizontal window at a relative position of the viewer canvas. */
async function brightnessAt(page: Page, rx: number, ry: number, span = 0): Promise<number> {
  return page.getByTestId('image-viewer').locator('canvas').evaluate(
    (c: HTMLCanvasElement, p) => {
      const x = Math.round(c.width * p.rx);
      const d = c.getContext('2d')!.getImageData(Math.max(0, x - p.span), Math.round(c.height * p.ry), 2 * p.span + 1, 1).data;
      let max = 0;
      for (let i = 0; i < d.length; i += 4) max = Math.max(max, (d[i]! + d[i + 1]! + d[i + 2]!) / 3);
      return max;
    },
    { rx, ry, span },
  );
}

test('analyses a new image in the background and reports it subtly', async ({ page }) => {
  await page.goto('/');
  const buffer = await createImage(page, { width: 1600, height: 1200, layout: 'left-right' });
  await pickFile(page, 'Bild auswählen', { name: 'a.jpg', mimeType: 'image/jpeg', buffer });
  await expectReady(page);
  await expectAnalysisReady(page);
  await expect(toolbar(page)).not.toContainText('analysiert');
  // The normal UI never shows the developer view.
  await expect(debug(page)).toHaveCount(0);
});

test.describe('developer analysis view (?debug=analysis)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?debug=analysis');
  });

  test('shows every layer; the edge layer lights up at the contour only', async ({ page }) => {
    // 16:10 so the image fills the viewer width and relative positions map directly.
    const buffer = await createImage(page, { width: 1600, height: 1000, layout: 'left-right' });
    await pickFile(page, 'Bild auswählen', { name: 'kante.jpg', mimeType: 'image/jpeg', buffer });
    await expectAnalysisReady(page);
    await expect(debug(page)).toHaveAttribute('data-analysis-size', '1024x640');
    await expect(page.getByTestId('analysis-stats')).toContainText('Analyse 1024×640 (Quelle 1600×1000)');
    await expect(page.getByTestId('analysis-stats')).toContainText('worker');

    for (const label of ['Original', 'Luminanz', 'Kontrast', 'Kanten', 'Detaildichte', 'Textur', 'Lokal', 'Global', 'Importance']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page.getByTestId('analysis-stats')).toContainText(label === 'Original' ? 'Analyse' : 'min');
    }

    await page.getByRole('button', { name: 'Kanten', exact: true }).click();
    await expect.poll(() => brightnessAt(page, 0.5, 0.5, 12)).toBeGreaterThan(200);
    expect(await brightnessAt(page, 0.25, 0.5)).toBeLessThan(10);
    expect(await brightnessAt(page, 0.75, 0.5)).toBeLessThan(10);

    // Heatmap is a view option only.
    await page.getByLabel('Heatmap').check();
    await expect.poll(() => brightnessAt(page, 0.5, 0.5, 12)).toBeGreaterThan(150);
  });

  test('image change: analysis is recomputed for the new image and never reused', async ({ page }) => {
    const first = await createImage(page, { width: 1600, height: 1200, layout: 'left-right' });
    await pickFile(page, 'Bild auswählen', { name: 'quer.jpg', mimeType: 'image/jpeg', buffer: first });
    await expectAnalysisReady(page);
    const firstId = await toolbar(page).getAttribute('data-image-id');
    await expect(debug(page)).toHaveAttribute('data-analysis-source', firstId!);
    await expect(debug(page)).toHaveAttribute('data-analysis-size', '1024x768');

    const second = await createImage(page, { width: 900, height: 1600, color: '#777777' });
    await pickFile(page, 'Anderes Bild', { name: 'hoch.jpg', mimeType: 'image/jpeg', buffer: second });
    await expectAnalysisReady(page);
    const secondId = await toolbar(page).getAttribute('data-image-id');
    expect(secondId).not.toBe(firstId);
    await expect(debug(page)).toHaveAttribute('data-analysis-source', secondId!);
    await expect(debug(page)).toHaveAttribute('data-analysis-size', '576x1024');

    // Uniform gray: no edges anywhere.
    await page.getByRole('button', { name: 'Kanten', exact: true }).click();
    await expect(page.getByTestId('analysis-stats')).toContainText('max 0.0');
  });

  test('removing the image discards the analysis view', async ({ page }) => {
    const buffer = await createImage(page, { width: 800, height: 600, layout: 'left-right' });
    await pickFile(page, 'Bild auswählen', { name: 'a.jpg', mimeType: 'image/jpeg', buffer });
    await expectAnalysisReady(page);
    await page.getByRole('button', { name: 'Bild entfernen' }).click();
    await expect(status(page)).toHaveAttribute('data-status', 'empty');
    await expect(debug(page)).toHaveCount(0);
  });
});
