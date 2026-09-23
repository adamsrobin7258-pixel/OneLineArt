import { expect, test, type Page } from '@playwright/test';
import { createArtwork, exportAndDownload, goToExport, imageDimensions, imagePanel, settingsScreen, trackWorkers, workers } from './exportHelpers';
import { createImage, pickFile } from './helpers';

type Core = typeof import('../src/core');
type Decoder = typeof import('../src/platform/browser/bitmapDecoder');

test.beforeEach(async ({ page }) => trackWorkers(page));

const toolbar = (page: Page) => page.getByTestId('image-toolbar');
const editor = (page: Page) => page.getByTestId('image-editor');

/** From the drawing back to the image step and into the editor. */
async function openEditor(page: Page) {
  if (await settingsScreen(page).isVisible()) await page.getByRole('button', { name: 'Zurück' }).click();
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await expect(editor(page)).toBeVisible();
}

async function applyAndDraw(page: Page) {
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(editor(page)).toBeHidden();
  await expect(toolbar(page)).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
}

test('rotate and crop: new analysis and drawing of the edited image; the original stays', async ({ page }) => {
  test.setTimeout(180_000);
  await createArtwork(page, { width: 900, height: 700 });
  expect(await workers(page, 'analysis')).toBe(1);
  expect(await workers(page, 'pathGeneration')).toBe(1);
  await expect(settingsScreen(page)).toHaveAttribute('data-render-size', '2048x1593');

  // Rotate right → portrait input.
  await openEditor(page);
  await page.getByRole('button', { name: 'Nach rechts drehen' }).click();
  await expect(page.getByTestId('crop-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(toolbar(page)).toHaveAttribute('data-edited', 'true');
  await expect(toolbar(page)).toHaveAttribute('data-processing-size', '700x900');
  await expect(toolbar(page)).toHaveAttribute('data-image-size', '900x700'); // original unchanged
  await expect(toolbar(page)).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  expect(await workers(page, 'analysis')).toBe(2);
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
  await expect(settingsScreen(page)).toHaveAttribute('data-render-size', '1593x2048');
  expect(await workers(page, 'pathGeneration')).toBe(2);

  // Square crop.
  await openEditor(page);
  await page.getByRole('radio', { name: '1:1' }).click();
  await applyAndDraw(page);
  await expect(settingsScreen(page)).toHaveAttribute('data-render-size', '2048x2048');
  expect(await workers(page, 'analysis')).toBe(3);
  expect(await workers(page, 'pathGeneration')).toBe(3);

  // Cancel changes nothing.
  await openEditor(page);
  await page.getByRole('button', { name: 'Nach links drehen' }).click();
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(toolbar(page)).toHaveAttribute('data-processing-size', '700x700');
  expect(await workers(page, 'analysis')).toBe(3);

  // Rendering changes after an edit still never recompute anything.
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('radio', { name: 'Verlauf' }).click();
  await page.getByRole('radio', { name: 'Foto' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-rendered-mode', 'sampled-color');
  expect(await workers(page, 'pathGeneration')).toBe(3);
  expect(await workers(page, 'analysis')).toBe(3);

  // "Original" export resolution = the crop in original pixels.
  await goToExport(page);
  await imagePanel(page).getByRole('radio', { name: 'Original' }).click();
  expect(imageDimensions((await exportAndDownload(page, 'Bild')).buffer)).toMatchObject({ width: 700, height: 700 });
});

test('zoom and pan select a detail; keyboard works; reset returns to the whole image', async ({ page }) => {
  test.setTimeout(120_000);
  await createArtwork(page, { width: 1000, height: 800 });
  await openEditor(page);
  const zoom = page.getByRole('slider', { name: 'Zoom' });
  await expect(zoom).toHaveAttribute('aria-valuetext', '1,0×');
  await zoom.focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight'); // 1 → 2×
  await expect(zoom).toHaveAttribute('aria-valuetext', '2,0×');
  const centred = await editor(page).getAttribute('data-edit');
  expect(centred).toBe('0:0.250000,0.250000,0.500000,0.500000');
  // Pan with the keyboard on the stage.
  await page.getByTestId('crop-stage').focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  await expect(editor(page)).toHaveAttribute('data-edit', '0:0.200000,0.250000,0.500000,0.500000');
  // Pan with the pointer: dragging the image right moves the crop left (clamped at the edge).
  const box = (await page.getByTestId('crop-stage').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 2000, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(editor(page)).toHaveAttribute('data-edit', '0:0.000000,0.250000,0.500000,0.500000');
  await applyAndDraw(page);
  await expect(settingsScreen(page)).toHaveAttribute('data-render-size', '2048x1638');
  await expect(toolbar(page)).toHaveCount(0);

  await openEditor(page);
  await expect(editor(page)).toHaveAttribute('data-edit', '0:0.000000,0.250000,0.500000,0.500000');
  await page.getByRole('button', { name: 'Zurücksetzen' }).click();
  await expect(editor(page)).toHaveAttribute('data-edit', '0:0.000000,0.000000,1.000000,1.000000');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(toolbar(page)).toHaveAttribute('data-edited', 'false');
  await expect(toolbar(page)).toHaveAttribute('data-processing-size', '1000x800');
});

test('a saved project reopens with the same edit and drawing, without recomputation', async ({ page }) => {
  test.setTimeout(180_000);
  await createArtwork(page, { width: 900, height: 600 });
  await openEditor(page);
  await page.getByRole('button', { name: 'Nach links drehen' }).click();
  await page.getByRole('radio', { name: '4:5' }).click();
  await applyAndDraw(page);
  const size = await settingsScreen(page).getAttribute('data-render-size');
  await page.getByTestId('save-project').click();
  await expect(page.getByTestId('save-project')).toHaveAttribute('data-save-status', 'saved');

  await page.reload();
  await page.getByRole('button', { name: 'Meine Werke' }).click();
  await page.getByTestId('gallery-item').first().getByRole('button', { name: /öffnen/ }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 20_000 });
  await expect(settingsScreen(page)).toHaveAttribute('data-render-size', size!);
  await expect(page.getByTestId('save-project')).toHaveText('Gespeichert');
  expect(await workers(page, 'analysis')).toBe(0);
  expect(await workers(page, 'pathGeneration')).toBe(0);
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(toolbar(page)).toHaveAttribute('data-edited', 'true');
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await expect(editor(page)).toHaveAttribute('data-edit', /^270:/);
});

test('edit pixels: identity = the import working copy; same edit = same pixels; exact quarter turns', async ({ page }) => {
  await page.goto('/');
  const buffer = await createImage(page, { width: 300, height: 200, type: 'image/png', layout: 'left-right' });
  const result = await page.evaluate(async (base64) => {
    const core: Core = await import('/src/core/index.ts' as string);
    const { bitmapDecoder, applyImageEdit }: Decoder = await import('/src/platform/browser/bitmapDecoder.ts' as string);
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'a.png', { type: 'image/png' });
    const imported = await core.importImage(file, { decoder: bitmapDecoder, createId: () => 'x' });
    const hash = (d: Uint8ClampedArray) => core.hashBytes(new Uint8Array(d.buffer, d.byteOffset, d.byteLength));
    const size = imported.original.metadata;
    const identity = await applyImageEdit(imported.preview, core.IDENTITY_EDIT, size);
    const edit = { rotation: 90 as const, crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 } };
    const a = await applyImageEdit(imported.preview, edit, size);
    const b = await applyImageEdit(imported.preview, edit, size);
    const turned = await applyImageEdit(imported.preview, { rotation: 90, crop: core.FULL_CROP }, size);
    // After a clockwise turn the left (red) half is on top.
    const px = (img: { width: number; data: Uint8ClampedArray }, x: number, y: number) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];
    return {
      identityEqual: hash(identity.pixels.data) === hash(imported.processed.pixels.data) && identity.preview === imported.preview,
      sameEdit: hash(a.pixels.data) === hash(b.pixels.data),
      editedSize: [a.pixels.width, a.pixels.height],
      expectedSize: core.editedSize(size, edit),
      turnedSize: [turned.pixels.width, turned.pixels.height],
      top: px(turned.pixels, 100, 10),
      bottom: px(turned.pixels, 100, 290),
      originalUnchanged: (await file.arrayBuffer()).byteLength === bytes.length,
    };
  }, buffer.toString('base64'));
  expect(result.identityEqual).toBe(true);
  expect(result.sameEdit).toBe(true);
  expect(result.editedSize).toEqual([result.expectedSize.width, result.expectedSize.height]);
  expect(result.turnedSize).toEqual([200, 300]);
  expect(result.top[0]).toBeGreaterThan(200);
  expect(result.top[2]).toBeLessThan(60);
  expect(result.bottom[2]).toBeGreaterThan(200);
  expect(result.originalUnchanged).toBe(true);
});

test('a new image starts unedited', async ({ page }) => {
  await createArtwork(page, { width: 600, height: 400 });
  await openEditor(page);
  await page.getByRole('button', { name: 'Nach rechts drehen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(toolbar(page)).toHaveAttribute('data-edited', 'true');
  await pickFile(page, 'Anderes Bild', { name: 'b.jpg', mimeType: 'image/jpeg', buffer: await createImage(page, { width: 500, height: 300 }) });
  await expect(toolbar(page)).toHaveAttribute('data-edited', 'false');
  await expect(toolbar(page)).toHaveAttribute('data-processing-size', '500x300');
});
