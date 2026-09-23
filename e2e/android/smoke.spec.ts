import { expect, test } from '@playwright/test';
import { createImage } from '../helpers';

/** The Android smoke flow (Phase 11, part 1) on the packaged web assets. */
test('android smoke: import → drawing → preview → export → save → restart → reopen', async ({ page, context }) => {
  const errors: string[] = [];
  const watch = (p: typeof page) => {
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    p.on('pageerror', (e) => errors.push(e.message));
  };
  watch(page);
  await context.addInitScript(() => {
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
  const workerCount = async (p: typeof page, name: string) => p.evaluate((n) => (window as unknown as { __workers: string[] }).__workers.filter((u) => u.includes(n)).length, name);

  // 1. start
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ein Foto. Eine Linie.' })).toBeVisible();
  // Touch device: photo wording and the camera option are offered.
  await expect(page.getByRole('button', { name: 'Foto aufnehmen' })).toBeVisible();

  // 2.–4. new work, import an existing picture, analysis (worker)
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Foto auswählen' }).tap();
  await (await chooser).setFiles([{ name: 'handy.jpg', mimeType: 'image/jpeg', buffer: await createImage(page, { width: 1200, height: 1600, layout: 'left-right' }) }]);
  await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 60_000 });
  expect(await workerCount(page, 'analysis')).toBe(1);

  // 5. one-line drawing (worker) on canvas
  await page.getByRole('button', { name: 'Weiter' }).tap();
  const settings = page.getByTestId('settings-screen');
  await expect(settings).toHaveAttribute('data-path-status', 'ready', { timeout: 90_000 });
  expect(await workerCount(page, 'pathGeneration')).toBe(1);
  await expect(page.getByText('Schritt 2 von 4')).toBeVisible();

  // 6. detail level, 7. black/colour
  await page.getByRole('radio', { name: 'Minimal' }).tap();
  await expect(settings).toHaveAttribute('data-detail-level', 'minimal');
  await expect(settings).toHaveAttribute('data-path-status', 'ready', { timeout: 90_000 });
  await page.getByRole('radio', { name: 'Farbe' }).tap();
  await expect(settings).toHaveAttribute('data-rendered-mode', 'sampled-color');

  // 8. preview, 9. animation
  await page.getByRole('button', { name: 'Weiter' }).tap();
  const canvas = page.getByTestId('animation-canvas');
  await page.getByRole('radio', { name: '5 s', exact: true }).tap();
  await page.getByRole('button', { name: 'Abspielen' }).tap();
  await expect(canvas).toHaveAttribute('data-status', 'playing');
  await page.getByRole('button', { name: 'Pause' }).tap();
  await page.getByRole('button', { name: 'Abspielen' }).tap();
  await expect(canvas).toHaveAttribute('data-status', 'finished', { timeout: 20_000 });

  // 10. export: image renders in the worker; video capability is detected
  await page.getByRole('button', { name: 'Weiter' }).tap();
  const exportScreen = page.getByTestId('export-screen');
  await page.getByRole('button', { name: 'Bild exportieren' }).tap();
  await expect(exportScreen).toHaveAttribute('data-export-status', 'ready', { timeout: 60_000 });
  await expect(page.getByTestId('export-ready')).toHaveAttribute('data-mime-type', 'image/png');
  await expect(page.getByRole('button', { name: 'Video exportieren' })).toBeEnabled({ timeout: 20_000 });

  // 12. save, 11. gallery
  await page.getByTestId('save-project').tap();
  await expect(page.getByTestId('save-project')).toHaveText('Gespeichert');
  await page.getByRole('button', { name: 'Meine Werke' }).tap();
  await expect(page.getByTestId('gallery-item')).toHaveCount(1);

  // 13. open again (no new analysis / path)
  await page.getByTestId('gallery-item').getByRole('button', { name: /öffnen/ }).tap();
  await expect(settings).toHaveAttribute('data-path-status', 'ready');
  await expect(settings).toHaveAttribute('data-detail-level', 'minimal');
  expect(await workerCount(page, 'analysis')).toBe(1);

  // 14. close the app, 15. start it again (same storage), 16. open the saved work
  await page.close();
  const again = await context.newPage();
  watch(again);
  await again.goto('/');
  await again.getByRole('button', { name: 'Meine Werke' }).tap();
  await expect(again.getByTestId('gallery-item')).toHaveCount(1);
  await again.getByTestId('gallery-item').getByRole('button', { name: /öffnen/ }).tap();
  const settings2 = again.getByTestId('settings-screen');
  await expect(settings2).toHaveAttribute('data-path-status', 'ready', { timeout: 30_000 });
  await expect(settings2).toHaveAttribute('data-rendered-mode', 'sampled-color');
  await expect(again.getByTestId('save-project')).toHaveText('Gespeichert');
  expect(await workerCount(again, 'analysis')).toBe(0);
  expect(await workerCount(again, 'pathGeneration')).toBe(0);

  expect(errors).toEqual([]);
});
