import { expect, test, type Page } from '@playwright/test';
import { createImage, pickFile } from './helpers';

const toolbar = (page: Page) => page.getByTestId('image-toolbar');
const settings = (page: Page) => page.getByTestId('settings-screen');
const workerCount = (page: Page, name: string) =>
  page.evaluate((n) => (window as unknown as { __workers: string[] }).__workers.filter((u) => u.includes(n)).length, name);

test.beforeEach(async ({ page }) => {
  // Count worker starts: analysis vs. path generation.
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

async function importAndContinue(page: Page, buffer: Buffer, name = 'a.jpg', button = 'Bild auswählen') {
  await pickFile(page, button, { name, mimeType: 'image/jpeg', buffer });
  await expect(toolbar(page)).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(settings(page)).toBeVisible();
}

const expectDrawing = (page: Page) => expect(settings(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });

test('detail levels: Balanced by default, three clear options, no technical terms', async ({ page }) => {
  await page.goto('/');
  await importAndContinue(page, await createImage(page, { width: 900, height: 700, layout: 'left-right' }));
  const group = page.getByRole('radiogroup', { name: 'Detailgrad' });
  await expect(group.getByRole('radio')).toHaveText(['Minimal', 'Balanced', 'Detail']);
  await expect(group.getByRole('radio', { name: 'Balanced' })).toHaveAttribute('aria-checked', 'true');
  await expectDrawing(page);
  await expect(page.getByRole('img', { name: 'One-Line-Zeichnung' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/pointBudget|gamma|curvature|demand|Parameter/i);
  await expect(page.getByRole('navigation', { name: 'Ablauf' }).locator('[aria-current="step"]')).toHaveText('Einstellungen');
});

test('changing the level recomputes only the line, never the analysis; switching back is instant', async ({ page }) => {
  await page.goto('/');
  await importAndContinue(page, await createImage(page, { width: 900, height: 700, layout: 'left-right' }));
  await expectDrawing(page);
  expect(await workerCount(page, 'analysis')).toBe(1);
  expect(await workerCount(page, 'pathGeneration')).toBe(1);

  await page.getByRole('radio', { name: 'Minimal' }).click();
  await expect(settings(page)).toHaveAttribute('data-detail-level', 'minimal');
  await expect(settings(page)).toHaveAttribute('data-path-current', 'false');
  await expect(page.getByRole('status').filter({ hasText: 'Zeichnung wird berechnet' })).toBeVisible();
  await expectDrawing(page);

  await page.getByRole('radio', { name: 'Detail' }).click();
  await expectDrawing(page);
  expect(await workerCount(page, 'pathGeneration')).toBe(3);

  // Back to Balanced: cached, no new computation.
  await page.getByRole('radio', { name: 'Balanced' }).click();
  await expect(settings(page)).toHaveAttribute('data-path-status', 'ready');
  expect(await workerCount(page, 'pathGeneration')).toBe(3);
  expect(await workerCount(page, 'analysis')).toBe(1); // the analysis ran exactly once
});

test('keyboard: arrow keys move between levels', async ({ page }) => {
  await page.goto('/');
  await importAndContinue(page, await createImage(page, { width: 600, height: 450, layout: 'left-right' }));
  await page.getByRole('radio', { name: 'Balanced' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Detail' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('radio', { name: 'Minimal' })).toHaveAttribute('aria-checked', 'true');
});

test('a new image starts at Balanced and never shows the previous drawing', async ({ page }) => {
  await page.goto('/');
  await importAndContinue(page, await createImage(page, { width: 900, height: 700, layout: 'left-right' }));
  await page.getByRole('radio', { name: 'Detail' }).click();
  await expectDrawing(page);

  await page.getByRole('button', { name: 'Zurück' }).click();
  await importAndContinue(page, await createImage(page, { width: 700, height: 900, color: '#555555' }), 'b.jpg', 'Anderes Bild');
  await expect(page.getByRole('radio', { name: 'Balanced' })).toHaveAttribute('aria-checked', 'true');
  await expectDrawing(page);
  expect(await workerCount(page, 'analysis')).toBe(2); // one analysis per image
});

test('developer comparison: three levels differ in line amount and in structure representation', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?debug=analysis');
  // A photo-like test image: gradient, shapes and fine texture.
  const buffer = await createImage(page, { width: 900, height: 700, layout: 'left-right' });
  await pickFile(page, 'Bild auswählen', { name: 'a.jpg', mimeType: 'image/jpeg', buffer });
  await expect(toolbar(page)).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Alle drei Stufen berechnen' }).click();
  const table = page.getByTestId('level-comparison');
  for (const level of ['minimal', 'balanced', 'detail']) {
    await expect(table.locator(`tr[data-level="${level}"]`)).toHaveAttribute('data-computed', 'true', { timeout: 60_000 });
  }
  const metric = async (level: string, name: string) => parseFloat((await table.locator(`tr[data-level="${level}"] td[data-metric="${name}"]`).innerText()).replace(',', '.'));
  expect(await metric('minimal', 'points')).toBeLessThan(await metric('balanced', 'points'));
  expect(await metric('balanced', 'points')).toBeLessThan(await metric('detail', 'points'));
  expect(await metric('minimal', 'length')).toBeLessThan(await metric('balanced', 'length'));
  expect(await metric('balanced', 'length')).toBeLessThan(await metric('detail', 'length'));
  expect(await metric('minimal', 'touched')).toBeLessThanOrEqual(await metric('balanced', 'touched'));
  expect(await metric('balanced', 'touched')).toBeLessThanOrEqual(await metric('detail', 'touched'));

  // Switching the level shows the cached result immediately.
  await table.locator('tr[data-level="minimal"]').click();
  await expect(page.getByTestId('analysis-debug')).toHaveAttribute('data-detail-level', 'minimal');
  await expect(page.getByTestId('analysis-debug')).toHaveAttribute('data-path-status', 'ready');
});
