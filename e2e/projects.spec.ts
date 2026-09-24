import { expect, test, type Page } from '@playwright/test';
import { exportAndDownload, imageDimensions, imagePanel, probeVideo, settingsScreen, trackWorkers, videoPanel, workers } from './exportHelpers';
import { pickFile } from './helpers';

test.beforeEach(async ({ page }) => trackWorkers(page));

const toolbar = (page: Page) => page.getByTestId('image-toolbar');
const canvas = (page: Page) => page.getByTestId('animation-canvas');
const items = (page: Page) => page.getByTestId('gallery-item');
const card = (page: Page, name: string | RegExp) => items(page).filter({ has: page.locator('.card__title', { hasText: name }) });
const section = (page: Page, name: 'Linie' | 'Darstellung' | 'Farbe') => page.getByRole('radiogroup', { name: 'Bereich' }).getByRole('radio', { name }).click();
const back = (page: Page) => page.evaluate(() => (window as unknown as { __systemBack: () => boolean }).__systemBack());
const ready = (page: Page) => expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
const checked = (page: Page, group: string) => page.getByRole('radiogroup', { name: group }).getByRole('radio', { checked: true });

async function photo(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const c = new OffscreenCanvas(900, 600);
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 900, 600);
    g.addColorStop(0, '#f2c14e');
    g.addColorStop(1, '#2d5d7b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 900, 600);
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(600, 220, 90, 0, Math.PI * 2);
    ctx.fill();
    const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  return Buffer.from(base64, 'base64');
}

async function slide(page: Page, name: string, keys: string[]) {
  await page.getByRole('slider', { name, exact: true }).focus();
  for (const key of keys) await page.keyboard.press(key);
}

async function openGallery(page: Page) {
  await page.getByRole('button', { name: 'Meine Werke' }).click();
  await expect(page.getByTestId('gallery-screen')).toBeVisible();
}

async function save(page: Page) {
  await page.getByTestId('save-project').click();
  await expect(page.getByTestId('save-project')).toHaveAttribute('data-save-status', 'saved');
}

/** Everything a work can remember, read from the UI. */
async function readAll(page: Page) {
  await expect(settingsScreen(page)).toBeVisible();
  const s = settingsScreen(page);
  await page.getByRole('button', { name: 'Anpassen' }).click();
  const detail = await page.getByRole('slider', { name: 'Detailgrad' }).getAttribute('aria-valuetext');
  const smoothing = await page.getByRole('slider', { name: 'Linienglättung' }).getAttribute('aria-valuetext');
  await section(page, 'Darstellung');
  const width = await page.getByRole('slider', { name: 'Linienbreite' }).getAttribute('aria-valuetext');
  const strength = await page.getByRole('slider', { name: 'Zeichenstärke' }).getAttribute('aria-valuetext');
  const lightness = await page.getByRole('slider', { name: 'Hintergrundhelligkeit' }).getAttribute('aria-valuetext');
  await section(page, 'Farbe');
  const palette = (await checked(page, 'Farbpalette').count()) ? await checked(page, 'Farbpalette').getAttribute('aria-label') : null;
  const start = page.getByLabel('Startfarbe', { exact: true });
  const gradient = (await start.count()) ? [await start.inputValue(), await page.getByLabel('Endfarbe', { exact: true }).inputValue()] : null;
  const line = page.getByLabel('Linienfarbe', { exact: true });
  const lineColor = (await line.count()) ? await line.inputValue() : null;
  const background = await checked(page, 'Hintergrundfarbe').textContent();
  const intensity = await page.getByRole('slider', { name: 'Farbintensität' }).getAttribute('aria-valuetext');
  await page.getByRole('button', { name: 'Anpassen' }).click();
  const drawing = {
    style: await s.getAttribute('data-style'),
    custom: await s.getAttribute('data-detail-custom'),
    colorMode: await s.getAttribute('data-color-mode'),
    size: await s.getAttribute('data-render-size'),
    detail,
    smoothing,
    width,
    strength,
    lightness,
    palette,
    gradient,
    lineColor,
    background,
    intensity,
  };
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Wiedergabe' }).click();
  const own = page.getByRole('slider', { name: 'Eigene Dauer' });
  const animation = {
    duration: (await own.count()) ? await own.getAttribute('aria-valuetext') : await checked(page, 'Dauer').textContent(),
    speed: await checked(page, 'Geschwindigkeit').textContent(),
    direction: await canvas(page).getAttribute('data-direction'),
    start: await canvas(page).getAttribute('data-start'),
    marker: await page.getByTestId('start-marker').count(),
  };
  await page.getByRole('button', { name: 'Wiedergabe' }).click();
  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
  const edited = await toolbar(page).getAttribute('data-edited');
  const processing = await toolbar(page).getAttribute('data-processing-size');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await ready(page);
  return { drawing, animation, image: { edited, processing } };
}

test('whole workflow: import → edit → drawing → colour → animation → save → gallery → reopen → export', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await pickFile(page, 'Bild auswählen', { name: 'motiv.png', mimeType: 'image/png', buffer: await photo(page) });
  await expect(toolbar(page)).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });

  // 2. Image: rotate, 4:5 crop, zoom, pan.
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await page.getByRole('button', { name: 'Nach links drehen' }).click();
  await page.getByRole('radio', { name: '4:5' }).click();
  await slide(page, 'Zoom', ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight']);
  await page.getByTestId('crop-stage').focus();
  await page.keyboard.press('ArrowDown');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(toolbar(page)).toHaveAttribute('data-edited', 'true');
  await expect(toolbar(page)).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await ready(page);

  // 3. Drawing: geometric, own detail; organic smoothing is kept for later; line width, strength, lightness.
  await page.getByRole('radio', { name: 'Geometrisch' }).click();
  await ready(page);
  await page.getByRole('button', { name: 'Anpassen' }).click();
  await slide(page, 'Detailgrad', ['ArrowRight', 'ArrowRight', 'ArrowRight']);
  await ready(page);
  await section(page, 'Darstellung');
  await slide(page, 'Linienbreite', ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight']);
  await slide(page, 'Zeichenstärke', ['ArrowLeft', 'ArrowLeft']);

  // 4. Colour: gradient with a palette on an own background, intensity.
  await page.getByRole('radio', { name: 'Verlauf' }).click();
  await section(page, 'Farbe');
  await page.getByRole('radio', { name: 'Ozean' }).click();
  await page.getByRole('radiogroup', { name: 'Hintergrundfarbe' }).getByRole('radio', { name: 'Eigene' }).click();
  const bg = page.getByLabel('Eigene Hintergrundfarbe', { exact: true });
  await bg.fill('#f6efe0');
  await bg.press('Enter');
  await slide(page, 'Farbintensität', ['ArrowRight', 'ArrowRight']);
  await section(page, 'Darstellung');
  await slide(page, 'Hintergrundhelligkeit', ['ArrowLeft']);
  await page.getByRole('button', { name: 'Anpassen' }).click();
  const paths = await workers(page, 'pathGeneration');

  // 5. Animation: own duration, speed, reverse, start point.
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('radio', { name: 'Eigene' }).click();
  await slide(page, 'Eigene Dauer', ['ArrowRight', 'ArrowRight', 'ArrowRight']); // 11,5 s
  await page.getByRole('button', { name: 'Wiedergabe' }).click();
  await page.getByRole('radio', { name: '2×' }).click();
  await page.getByRole('radio', { name: 'Rückwärts' }).click();
  await page.getByRole('button', { name: 'Startpunkt setzen' }).click();
  const box = (await page.getByTestId('start-picker').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.6);
  await expect(page.getByTestId('start-marker')).toBeVisible();
  await page.getByRole('button', { name: 'Wiedergabe' }).click();

  // 6. Preview plays to the end.
  await page.getByRole('button', { name: 'Abspielen' }).click();
  await expect(canvas(page)).toHaveAttribute('data-status', 'finished', { timeout: 20_000 });
  expect(await workers(page, 'pathGeneration')).toBe(paths); // none of 4–6 recomputed the drawing

  // 7. Save.
  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
  await ready(page);
  await save(page);
  const before = await readAll(page);
  expect(before.drawing).toMatchObject({ style: 'geometric', custom: 'true', colorMode: 'gradient', palette: 'Ozean', background: 'Eigene', width: '1,50', strength: '90 %' });
  expect(before.animation).toMatchObject({ duration: '11,5 s', speed: '2×', direction: 'reverse', marker: 1 });
  expect(before.image.edited).toBe('true');

  // 8–10. Restart, gallery, reopen: everything is back, nothing is recomputed.
  await page.reload();
  await openGallery(page);
  await expect(items(page)).toHaveCount(1);
  await expect(items(page).first()).toContainText('Geometrisch');
  await items(page).first().getByRole('button', { name: /öffnen/ }).click();
  await ready(page);
  const after = await readAll(page);
  expect(after).toEqual(before);
  expect(await workers(page, 'analysis')).toBe(0);
  expect(await workers(page, 'pathGeneration')).toBe(0);
  await expect(page.getByTestId('save-project')).toHaveText('Gespeichert');

  // 11. Image export: the edited 4:5 image at the stored rendering.
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await imagePanel(page).getByRole('radio', { name: '2048 px', exact: true }).click();
  const image = imageDimensions((await exportAndDownload(page, 'Bild')).buffer);
  expect(image.height).toBe(2048);
  expect(image.width / image.height).toBeCloseTo(4 / 5, 2);

  // 12. Video export: 11.5 s ÷ 2 = 5.75 s drawing + 2 s hold.
  await videoPanel(page).getByRole('radio', { name: '1080p' }).click();
  const video = await probeVideo((await exportAndDownload(page, 'Video', 120_000)).buffer);
  expect(video.durationS).toBeCloseTo(7.75, 0);
  expect(await workers(page, 'pathGeneration')).toBe(0);
});

test('duplicate: the copy is independent — changing it leaves the original unchanged', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await pickFile(page, 'Bild auswählen', { name: 'motiv.png', mimeType: 'image/png', buffer: await photo(page) });
  await expect(toolbar(page)).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await ready(page);
  await page.getByRole('radio', { name: 'Verlauf' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('radio', { name: '15 s', exact: true }).click();
  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
  await save(page);
  await openGallery(page);
  await items(page).first().getByRole('button', { name: 'Umbenennen' }).click();
  await page.getByLabel('Name').fill('Original');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(card(page, 'Original')).toHaveCount(1);
  const original = await readOriginal(page);

  // Duplicate and open the copy.
  await card(page, 'Original').getByRole('button', { name: 'Duplizieren' }).click();
  await expect(items(page)).toHaveCount(2);
  await expect(card(page, 'Original – Kopie')).toHaveCount(1);
  await card(page, 'Original – Kopie').getByRole('button', { name: /öffnen/ }).click();
  await ready(page);
  // Change colour, animation and the image, then save the copy.
  await page.getByRole('radio', { name: 'Einfarbig' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('radio', { name: '5 s', exact: true }).click();
  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await page.getByRole('button', { name: 'Nach rechts drehen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(toolbar(page)).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await ready(page);
  await save(page);

  // The original is unchanged.
  await openGallery(page);
  await expect(items(page)).toHaveCount(2);
  await card(page, /^Original$/).getByRole('button', { name: /öffnen/ }).click();
  await ready(page);
  expect(await readState(page)).toEqual(original);
});

/** Colour mode, duration and image state of the open work. */
async function readState(page: Page) {
  const colorMode = await settingsScreen(page).getAttribute('data-color-mode');
  const size = await settingsScreen(page).getAttribute('data-render-size');
  await page.getByRole('button', { name: 'Weiter' }).click();
  const duration = await page.locator('.player__time').textContent();
  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
  const edited = await toolbar(page).getAttribute('data-edited');
  await page.getByRole('button', { name: 'Weiter' }).click();
  return { colorMode, size, duration, edited };
}

async function readOriginal(page: Page) {
  await card(page, 'Original').getByRole('button', { name: /öffnen/ }).click();
  await ready(page);
  const state = await readState(page);
  await openGallery(page);
  return state;
}

test('favourites, rename (no empty names) and delete with confirmation survive a restart', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await pickFile(page, 'Bild auswählen', { name: 'a.png', mimeType: 'image/png', buffer: await photo(page) });
  await expect(toolbar(page)).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await ready(page);
  await save(page);
  await openGallery(page);
  await items(page).first().getByRole('button', { name: 'Duplizieren' }).click();
  await expect(items(page)).toHaveCount(2);

  // Rename: empty names cannot be saved; cancel keeps the old name.
  const second = items(page).nth(1);
  await second.getByRole('button', { name: 'Umbenennen' }).click();
  const field = page.getByLabel('Name');
  await field.fill('   ');
  await expect(page.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
  await expect(page.getByText('Bitte einen Namen eingeben.')).toBeVisible();
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await second.getByRole('button', { name: 'Umbenennen' }).click();
  await field.fill('Lieblingsbild');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(card(page, 'Lieblingsbild')).toHaveCount(1);

  // Favourite: set → listed first → survives a restart → remove.
  await card(page, 'Lieblingsbild').getByRole('button', { name: /^Favorit/ }).click();
  await expect(card(page, 'Lieblingsbild')).toHaveAttribute('data-favorite', 'true');
  await expect(items(page).first()).toHaveAttribute('data-favorite', 'true');
  await page.reload();
  await openGallery(page);
  await expect(items(page).first()).toContainText('Lieblingsbild');
  await expect(items(page).first()).toHaveAttribute('data-favorite', 'true');
  await expect(items(page).first().getByRole('button', { name: /^Favorit/ })).toHaveAttribute('aria-pressed', 'true');
  await items(page).first().getByRole('button', { name: /^Favorit/ }).click();
  await expect(card(page, 'Lieblingsbild')).toHaveAttribute('data-favorite', 'false');

  // Delete: cancel keeps it, confirm removes it (and only it).
  await card(page, 'Lieblingsbild').getByRole('button', { name: 'Löschen' }).click();
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(items(page)).toHaveCount(2);
  await card(page, 'Lieblingsbild').getByRole('button', { name: 'Löschen' }).click();
  await page.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(items(page)).toHaveCount(1);
  await expect(card(page, 'Lieblingsbild')).toHaveCount(0);
  // The remaining work still opens (its photo was shared, not deleted).
  await items(page).first().getByRole('button', { name: /öffnen/ }).click();
  await ready(page);
});

test('export again from the gallery uses the stored settings, not the current ones', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await pickFile(page, 'Bild auswählen', { name: 'a.png', mimeType: 'image/png', buffer: await photo(page) });
  await expect(toolbar(page)).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await page.getByRole('radio', { name: '1:1' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(toolbar(page)).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await ready(page);
  await page.getByRole('radio', { name: 'Foto' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('radio', { name: '5 s', exact: true }).click();
  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
  await save(page);

  // Change the current work afterwards (not saved): other colour mode and duration.
  await page.getByRole('radio', { name: 'Einfarbig' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('radio', { name: '30 s', exact: true }).click();

  await openGallery(page);
  await items(page).first().getByRole('button', { name: 'Erneut exportieren' }).click();
  await expect(page.getByTestId('export-screen')).toBeVisible();
  await expect(videoPanel(page).getByRole('radio', { name: 'Foto' })).toHaveAttribute('aria-checked', 'true');
  await expect(videoPanel(page).getByRole('radio', { name: '5 s', exact: true })).toHaveAttribute('aria-checked', 'true');
  await imagePanel(page).getByRole('radio', { name: 'Original' }).click();
  expect(imageDimensions((await exportAndDownload(page, 'Bild')).buffer)).toMatchObject({ width: 600, height: 600 });
  await videoPanel(page).getByRole('radio', { name: '1080p' }).click();
  expect((await probeVideo((await exportAndDownload(page, 'Video', 120_000)).buffer)).durationS).toBeCloseTo(7, 0);
  expect(await workers(page, 'pathGeneration')).toBe(1); // only the original drawing, never again
});

test('Android back: panels, picking, editor and dialogs close first, then the steps go back', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await pickFile(page, 'Bild auswählen', { name: 'a.png', mimeType: 'image/png', buffer: await photo(page) });
  await expect(toolbar(page)).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });

  // Image editor: back = cancel.
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await expect(page.getByTestId('image-editor')).toBeVisible();
  expect(await back(page)).toBe(true);
  await expect(page.getByTestId('image-editor')).toBeHidden();
  await expect(toolbar(page)).toHaveAttribute('data-edited', 'false');

  await page.getByRole('button', { name: 'Weiter' }).click();
  await ready(page);
  // Drawing: panel first, then the step.
  await page.getByRole('button', { name: 'Anpassen' }).click();
  expect(await back(page)).toBe(true);
  await expect(page.getByTestId('adjust-panel')).toBeHidden();
  await expect(settingsScreen(page)).toBeVisible();

  // Preview: picking → panel → step.
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Wiedergabe' }).click();
  await page.getByRole('button', { name: 'Startpunkt setzen' }).click();
  await expect(page.getByTestId('start-picker')).toBeVisible();
  expect(await back(page)).toBe(true);
  await expect(page.getByTestId('start-picker')).toBeHidden();
  await expect(page.getByTestId('playback-panel')).toBeVisible();
  expect(await back(page)).toBe(true);
  await expect(page.getByTestId('playback-panel')).toBeHidden();
  await expect(page.getByTestId('animation-screen')).toBeVisible();

  // Export → preview → drawing → image → background (not handled).
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByTestId('export-screen')).toBeVisible();
  expect(await back(page)).toBe(true);
  await expect(page.getByTestId('animation-screen')).toBeVisible();
  expect(await back(page)).toBe(true);
  await expect(settingsScreen(page)).toBeVisible();

  // Gallery with a dialog: dialog first, then leave the gallery.
  await save(page);
  await openGallery(page);
  await items(page).first().getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await back(page)).toBe(true);
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(items(page)).toHaveCount(1);
  expect(await back(page)).toBe(true);
  await expect(settingsScreen(page)).toBeVisible();
  expect(await back(page)).toBe(true);
  await expect(toolbar(page)).toBeVisible();
  expect(await back(page)).toBe(false); // first step: the app goes to the background
});
