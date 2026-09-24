import { expect, test, type Page } from '@playwright/test';
import { createImage, pickFile } from './helpers';

/**
 * The Android app's project-file buttons in the real UI: Capacitor runs as
 * platform "android" with a stand-in for the native MediaExport plugin
 * (records every call and reassembles the transferred bytes). "Speichern" →
 * system "save as" dialog (saveAs), "Teilen" → share sheet (unchanged).
 */
type SaveAsAnswer = 'saved' | 'cancelled' | 'failed';
interface NativeLog {
  calls: { method: string; options: Record<string, unknown> }[];
  files: Record<string, { fileName: string; mimeType: string; chunks: string[] }>;
  saveAs: SaveAsAnswer;
}

async function androidApp(page: Page) {
  await page.addInitScript(() => {
    const log: NativeLog = { calls: [], files: {}, saveAs: 'saved' };
    const w = window as unknown as Record<string, unknown>;
    w.__native = log;
    w.CapacitorCustomPlatform = { name: 'android' };
    const methods = ['begin', 'append', 'saveToGallery', 'saveAs', 'share', 'discard'].map((name) => ({ name, rtype: 'promise' }));
    w.Capacitor = {
      PluginHeaders: [{ name: 'MediaExport', methods }],
      nativePromise: async (plugin: string, method: string, options: Record<string, unknown>) => {
        if (plugin !== 'MediaExport') throw new Error(`unexpected ${plugin}.${method}`);
        log.calls.push({ method, options: method === 'append' ? { id: options.id } : options });
        const id = options.id as string;
        switch (method) {
          case 'begin': {
            const next = `f${Object.keys(log.files).length}`;
            log.files[next] = { fileName: options.fileName as string, mimeType: options.mimeType as string, chunks: [] };
            return { id: next };
          }
          case 'append':
            log.files[id]!.chunks.push(options.data as string);
            return undefined;
          case 'saveAs':
            if (log.saveAs === 'failed') throw new Error('Saving the file failed');
            return log.saveAs === 'saved' ? { saved: true, uri: `content://documents/${id}` } : { saved: false };
          case 'share':
          case 'discard':
            return undefined;
          default:
            throw new Error(`unexpected ${method}`);
        }
      },
    };
  });
}
const native = (page: Page) => page.evaluate(() => (window as unknown as { __native: NativeLog }).__native);
const answerSaveAs = (page: Page, answer: SaveAsAnswer) => page.evaluate((a) => ((window as unknown as { __native: NativeLog }).__native.saveAs = a), answer);
/** The bytes the native side received for an export (base64 chunks joined). */
const transferred = (log: NativeLog, id: string) => Buffer.concat(log.files[id]!.chunks.map((c) => Buffer.from(c, 'base64')));

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('Android: the project file can be saved via the system file dialog ("Speichern") and still shared ("Teilen")', async ({ page }) => {
  test.setTimeout(180_000);
  await androidApp(page);
  await page.goto('/');
  await pickFile(page, 'Foto auswählen', { name: 'hafen.jpg', mimeType: 'image/jpeg', buffer: await createImage(page, { layout: 'left-right', width: 800, height: 600 }) });
  await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Weiter' }).tap();
  await expect(page.getByTestId('settings-screen')).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Weiter' }).tap();
  await page.getByRole('button', { name: 'Weiter' }).tap();
  await expect(page.getByTestId('export-screen')).toBeVisible();

  await page.getByRole('button', { name: 'Projektdatei exportieren' }).tap();
  const ready = page.getByTestId('project-file-ready');
  await expect(ready).toBeVisible({ timeout: 30_000 });
  const fileName = (await ready.getAttribute('data-file-name'))!;
  expect(fileName).toMatch(/^OneLine \d{4}-\d{2}-\d{2} \d{4}\.onelineart$/);
  // Android: "Speichern" (file dialog) and "Teilen"; no gallery button for a project file.
  await expect(ready.getByRole('button', { name: 'Speichern' })).toBeVisible();
  await expect(ready.getByRole('button', { name: 'Teilen' })).toBeVisible();
  await expect(ready.getByRole('button', { name: /Galerie/ })).toHaveCount(0);

  // Cancelled dialog: no error, nothing shown, the button stays usable.
  await answerSaveAs(page, 'cancelled');
  await ready.getByRole('button', { name: 'Speichern' }).tap();
  await expect(ready.getByRole('button', { name: 'Speichern' })).toBeEnabled();
  await expect(page.getByTestId('file-saved')).toHaveCount(0);
  await expect(page.getByTestId('file-save-failed')).toHaveCount(0);

  // A real failure: clear message and a retry.
  await answerSaveAs(page, 'failed');
  await ready.getByRole('button', { name: 'Speichern' }).tap();
  await expect(page.getByTestId('file-save-failed')).toContainText('Die Datei konnte nicht gespeichert werden');
  await answerSaveAs(page, 'saved');
  await page.getByTestId('file-save-failed').getByRole('button', { name: 'Erneut versuchen' }).tap();
  await expect(page.getByTestId('file-saved')).toContainText('Gespeichert');
  await expect(page.getByTestId('file-save-failed')).toHaveCount(0);

  // "Teilen" works as before, with the same transferred file.
  await ready.getByRole('button', { name: 'Teilen' }).tap();

  const log = await native(page);
  const calls = log.calls.map((c) => c.method);
  expect(calls.filter((m) => m === 'begin')).toHaveLength(1); // one transfer for all actions
  expect(calls.filter((m) => m === 'saveAs')).toHaveLength(3);
  expect(calls.at(-1)).toBe('share');
  const saveAs = log.calls.find((c) => c.method === 'saveAs')!.options;
  expect(saveAs).toMatchObject({ id: 'f0', mimeType: 'application/octet-stream', fileName });
  expect(log.calls.find((c) => c.method === 'share')!.options).toMatchObject({ id: 'f0', mimeType: 'application/octet-stream', title: fileName });
  expect(log.files.f0).toMatchObject({ fileName, mimeType: 'application/octet-stream' });

  // The saved bytes ARE the project file: a valid ".onelineart" that imports as a work.
  const bytes = transferred(log, 'f0');
  expect(bytes.subarray(0, 10).toString('ascii')).toBe('ONELINEART');
  expect(bytes.length).toBe(Number(await ready.getAttribute('data-file-size')));
  await page.getByRole('button', { name: 'Meine Werke' }).tap();
  await page.getByTestId('project-import-input').setInputFiles({ name: fileName, mimeType: 'application/octet-stream', buffer: bytes });
  await expect(page.getByTestId('project-import-done')).toContainText('wurde importiert');
  await expect(page.getByTestId('gallery-item')).toHaveCount(1);
});

test('Android: images and videos keep "In Galerie speichern" (no file dialog for media)', async ({ page }) => {
  test.setTimeout(180_000);
  await androidApp(page);
  await page.goto('/');
  await pickFile(page, 'Foto auswählen', { name: 'hafen.jpg', mimeType: 'image/jpeg', buffer: await createImage(page, { layout: 'left-right', width: 600, height: 400 }) });
  await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Weiter' }).tap();
  await expect(page.getByTestId('settings-screen')).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Weiter' }).tap();
  await page.getByRole('button', { name: 'Weiter' }).tap();
  await page.getByRole('radiogroup', { name: 'Auflösung' }).first().getByRole('radio', { name: '2048 px' }).tap();
  await page.getByRole('button', { name: 'Bild exportieren' }).tap();
  const ready = page.getByTestId('export-ready');
  await expect(ready).toBeVisible({ timeout: 60_000 });
  await expect(ready.getByRole('button', { name: 'In Galerie speichern' })).toBeVisible();
  await expect(ready.getByRole('button', { name: 'Speichern', exact: true })).toHaveCount(0);
  await expect(ready.getByRole('button', { name: 'Teilen' })).toBeVisible();
});
