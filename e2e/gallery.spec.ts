import { expect, test, type Page } from '@playwright/test';
import { createArtwork, exportAndDownload, goToExport, imageDimensions, settingsScreen, trackWorkers, workers } from './exportHelpers';

test.beforeEach(async ({ page }) => trackWorkers(page));

const gallery = (page: Page) => page.getByTestId('gallery-screen');
const items = (page: Page) => page.getByTestId('gallery-item');
const saveButton = (page: Page) => page.getByTestId('save-project');

async function save(page: Page) {
  await saveButton(page).click();
  await expect(saveButton(page)).toHaveAttribute('data-save-status', 'saved');
  await expect(saveButton(page)).toHaveText('Gespeichert');
}

async function openGallery(page: Page) {
  await page.getByRole('button', { name: 'Meine Werke' }).click();
  await expect(gallery(page)).toBeVisible();
}

test('empty gallery offers to create the first work', async ({ page }) => {
  await page.goto('/');
  await openGallery(page);
  await expect(page.getByText('Noch keine Werke')).toBeVisible();
  await page.getByRole('button', { name: 'Erstes Werk erstellen' }).click();
  await expect(page.getByTestId('import-screen')).toBeVisible();
});

test('save → restart → open: same drawing and settings without analysis or path generation', async ({ page }) => {
  test.setTimeout(180_000);
  await createArtwork(page, { width: 900, height: 600 }, { detail: 'Detail' });
  await page.getByRole('radio', { name: 'Farbe' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-rendered-mode', 'sampled-color');
  await save(page);
  // Any change makes it unsaved again; saving updates the same project.
  await page.getByRole('radio', { name: 'Schwarz' }).click();
  await expect(saveButton(page)).toHaveText('Speichern');
  await page.getByRole('radio', { name: 'Farbe' }).click();
  await expect(saveButton(page)).toHaveText('Gespeichert');
  const pointCount = await page.evaluate(() => document.querySelector('[data-testid="settings-screen"]')?.getAttribute('data-render-size'));

  await openGallery(page);
  await expect(items(page)).toHaveCount(1);
  // Thumbnail rendered from the artwork: 512 px long edge.
  const thumb = items(page).first().locator('img');
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([512, 341]);
  await expect(items(page).first()).toContainText('Detail');

  // Restart: reload the app (IndexedDB persists).
  await page.reload();
  await openGallery(page);
  await expect(items(page)).toHaveCount(1);
  await items(page).first().getByRole('button', { name: /öffnen/ }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 20_000 });
  await expect(settingsScreen(page)).toHaveAttribute('data-detail-level', 'detail');
  await expect(settingsScreen(page)).toHaveAttribute('data-rendered-mode', 'sampled-color');
  await expect(settingsScreen(page)).toHaveAttribute('data-render-size', pointCount!);
  await expect(saveButton(page)).toHaveText('Gespeichert');
  expect(await workers(page, 'analysis')).toBe(0);
  expect(await workers(page, 'pathGeneration')).toBe(0);

  // Animation and export work from the stored project.
  await goToExport(page);
  const file = await exportAndDownload(page, 'Bild');
  expect(imageDimensions(file.buffer)).toMatchObject({ width: 4096, height: 2731 });
  expect(await workers(page, 'analysis')).toBe(0);
  expect(await workers(page, 'pathGeneration')).toBe(0);

  // A different detail level needs the analysis now (deferred until here).
  await page.getByRole('button', { name: 'Zurück' }).click();
  await page.getByRole('button', { name: 'Zurück' }).click();
  await page.getByRole('radio', { name: 'Minimal' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
  expect(await workers(page, 'analysis')).toBe(1);
  expect(await workers(page, 'pathGeneration')).toBe(1);
  // Back to Detail: the stored drawing again, no computation.
  await page.getByRole('radio', { name: 'Detail' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready');
  expect(await workers(page, 'pathGeneration')).toBe(1);
});

test('the stored original is byte-identical to the imported file', async ({ page }) => {
  test.setTimeout(120_000);
  await createArtwork(page, { width: 800, height: 600 });
  await save(page);
  const same = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('one-line-art');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const get = <T,>(store: string) =>
      new Promise<T[]>((resolve) => {
        const req = db.transaction(store).objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result as T[]);
      });
    const [images, projects] = await Promise.all([get<{ data: Blob; contentHash: string }>('images'), get<{ image: { contentHash: string; metadata: { fileSizeBytes: number } } }>('projects')]);
    return { images: images.length, size: images[0]!.data.size, expected: projects[0]!.image.metadata.fileSizeBytes, hash: images[0]!.contentHash === projects[0]!.image.contentHash };
  });
  expect(same).toEqual({ images: 1, size: same.expected, expected: same.expected, hash: true });
});

test('rename and delete with confirmation; deleting the open work unlinks it', async ({ page }) => {
  test.setTimeout(180_000);
  await createArtwork(page, { width: 800, height: 600 });
  await save(page);
  await openGallery(page);
  await items(page).first().getByRole('button', { name: 'Umbenennen' }).click();
  await items(page).first().getByRole('textbox', { name: 'Name' }).fill('Am Meer');
  await items(page).first().getByRole('button', { name: 'OK' }).click();
  await expect(items(page).first()).toContainText('Am Meer');
  await page.reload();
  await openGallery(page);
  await expect(items(page).first()).toContainText('Am Meer');
  // The name is used for export file names after opening.
  await items(page).first().getByRole('button', { name: /öffnen/ }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 20_000 });
  await goToExport(page);
  const file = await exportAndDownload(page, 'Bild');
  expect(file.fileName).toMatch(/^Am_Meer_\d{4}-\d{2}-\d{2}_\d{4}\.png$/);

  await openGallery(page);
  await items(page).first().getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByText('Werk wirklich löschen?')).toBeVisible();
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(items(page)).toHaveCount(1);
  await items(page).first().getByRole('button', { name: 'Löschen' }).click();
  await page.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(page.getByText('Noch keine Werke')).toBeVisible();
  // Everything of it is gone from IndexedDB.
  const counts = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open('one-line-art');
      req.onsuccess = () => resolve(req.result);
    });
    const count = (store: string) =>
      new Promise<number>((resolve) => {
        const req = db.transaction(store).objectStore(store).count();
        req.onsuccess = () => resolve(req.result);
      });
    return Promise.all(['projects', 'paths', 'images', 'thumbnails'].map(count));
  });
  expect(counts).toEqual([0, 0, 0, 0]);
  // The open work stays usable, but is no longer stored.
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(saveButton(page)).toHaveText('Speichern');
});

test('damaged and incompatible stored projects are shown, cannot be opened, can be deleted', async ({ page }) => {
  test.setTimeout(120_000);
  await createArtwork(page, { width: 800, height: 600 });
  await save(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open('one-line-art');
      req.onsuccess = () => resolve(req.result);
    });
    const tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').put({ formatVersion: 1, id: 'broken', name: 'kaputt', updatedAt: '2030-01-01T00:00:00Z' }, 'broken');
    tx.objectStore('projects').put({ formatVersion: 99, id: 'future', name: 'neu', updatedAt: '2029-01-01T00:00:00Z' }, 'future');
    await new Promise((resolve) => (tx.oncomplete = resolve));
  });
  await openGallery(page);
  await expect(items(page)).toHaveCount(3);
  const broken = items(page).and(page.locator('[data-project-id="broken"]'));
  await expect(broken).toHaveAttribute('data-status', 'damaged');
  await expect(broken.getByRole('button', { name: /öffnen/ })).toBeDisabled();
  await expect(items(page).and(page.locator('[data-project-id="future"]'))).toHaveAttribute('data-status', 'incompatible');
  await expect(items(page).and(page.locator('[data-status="ok"]'))).toHaveCount(1);
  await broken.getByRole('button', { name: 'Löschen' }).click();
  await page.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(items(page)).toHaveCount(2);
});

test('a project whose path data is missing reports a damaged work instead of crashing', async ({ page }) => {
  test.setTimeout(120_000);
  await createArtwork(page, { width: 800, height: 600 });
  await save(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open('one-line-art');
      req.onsuccess = () => resolve(req.result);
    });
    const tx = db.transaction('paths', 'readwrite');
    tx.objectStore('paths').clear();
    await new Promise((resolve) => (tx.oncomplete = resolve));
  });
  await openGallery(page);
  await items(page).first().getByRole('button', { name: /öffnen/ }).click();
  await expect(page.getByTestId('gallery-error')).toContainText('Dieses Werk ist beschädigt');
  await expect(gallery(page)).toBeVisible();
});

test('storage unavailable: saving reports it clearly', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
  });
  await createArtwork(page, { width: 800, height: 600 });
  await saveButton(page).click();
  await expect(page.getByTestId('save-error')).toHaveText('Speichern ist hier nicht möglich');
  await openGallery(page);
  await expect(page.getByTestId('gallery-error')).toContainText('Speichern ist hier nicht möglich');
});
