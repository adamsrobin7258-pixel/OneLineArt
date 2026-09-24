import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createArtwork, exportScreen, settingsScreen, trackWorkers, workers } from './exportHelpers';
import { createImage, pickFile } from './helpers';

test.beforeEach(async ({ page }) => trackWorkers(page));

const items = (page: Page) => page.getByTestId('gallery-item');
const titles = (page: Page) => page.locator('[data-testid=gallery-item] .card__title');
const card = (page: Page, name: string) => items(page).filter({ has: page.locator('.card__title', { hasText: new RegExp(`^${name}$`) }) });
const canvas = (page: Page) => page.getByTestId('animation-canvas');
const ready = (page: Page) => expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
const checked = (page: Page, group: string) => page.getByRole('radiogroup', { name: group }).getByRole('radio', { checked: true });
const radio = (page: Page, group: string, name: string) => page.getByRole('radiogroup', { name: group }).getByRole('radio', { name, exact: true });

async function openGallery(page: Page) {
  await page.getByRole('button', { name: 'Meine Werke' }).click();
  await expect(page.getByTestId('gallery-screen')).toBeVisible();
}
async function save(page: Page) {
  await page.getByTestId('save-project').click();
  await expect(page.getByTestId('save-project')).toHaveAttribute('data-save-status', 'saved');
}
async function openPanel(page: Page) {
  if (!(await page.getByTestId('playback-panel').isVisible())) await page.getByRole('button', { name: 'Wiedergabe' }).click();
}
async function pickStart(page: Page, x: number, y: number) {
  await openPanel(page);
  await page.getByRole('button', { name: 'Startpunkt setzen' }).click();
  const box = (await page.getByTestId('start-picker').boundingBox())!;
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  await expect(page.getByTestId('start-marker')).toBeVisible();
}
/** Exports the current work as a project file (export step) and returns the downloaded file. */
async function exportProjectFile(page: Page) {
  await page.getByRole('button', { name: 'Projektdatei exportieren' }).click();
  const ready = page.getByTestId('project-file-ready');
  await expect(ready).toBeVisible({ timeout: 30_000 });
  const downloading = page.waitForEvent('download');
  await ready.getByRole('button', { name: 'Herunterladen' }).click();
  const download = await downloading;
  // The name the app gives the file (the browser's suggestion depends on the system locale for non-ASCII names).
  return { fileName: (await ready.getAttribute('data-file-name'))!, buffer: await readFile((await download.path())!) };
}
async function importProjectFile(page: Page, name: string, buffer: Buffer) {
  await page.getByTestId('project-import-input').setInputFiles({ name, mimeType: 'application/octet-stream', buffer });
}

/** Everything the work shows for its settings (drawing, look, animation). */
async function readWork(page: Page) {
  const s = settingsScreen(page);
  const drawing = { style: await s.getAttribute('data-style'), engine: await s.getAttribute('data-engine'), detail: await checked(page, 'Detailgrad').textContent(), display: await checked(page, 'Darstellung').textContent() };
  await page.getByRole('button', { name: 'Anpassen' }).click();
  await radio(page, 'Bereich', 'Darstellung').click();
  const lineWidth = await page.getByRole('slider', { name: 'Linienbreite' }).getAttribute('aria-valuetext');
  await page.getByRole('button', { name: 'Anpassen' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await openPanel(page);
  const animation = {
    start: await canvas(page).getAttribute('data-start'),
    direction: await canvas(page).getAttribute('data-direction'),
    speed: await checked(page, 'Geschwindigkeit').textContent(),
    loop: await checked(page, 'Wiederholen').textContent(),
  };
  await page.getByRole('button', { name: 'Wiedergabe' }).click();
  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
  await ready(page);
  return { ...drawing, lineWidth, ...animation };
}

test('13.6 project file: export → import restores the work completely, as a new project; broken files are refused', async ({ page }) => {
  test.setTimeout(300_000);
  await createArtwork(page, { width: 800, height: 600 }, { detail: 'Minimal' });
  await page.getByRole('radio', { name: 'Orthogonal' }).click();
  await ready(page);
  await page.getByRole('radio', { name: 'Verlauf' }).click();
  await page.getByRole('button', { name: 'Anpassen' }).click();
  await radio(page, 'Bereich', 'Darstellung').click();
  await page.getByRole('slider', { name: 'Linienbreite' }).focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Anpassen' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await openPanel(page);
  await radio(page, 'Geschwindigkeit', '2×').click();
  await radio(page, 'Richtung', 'Rückwärts').click();
  await radio(page, 'Wiederholen', 'Endlos').click();
  await pickStart(page, 0.3, 0.6);
  await page.getByRole('button', { name: 'Wiedergabe' }).click();
  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
  await ready(page);
  await save(page);
  await openGallery(page);
  await items(page).first().getByRole('button', { name: 'Umbenennen' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Hafen');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await items(page).first().getByRole('button', { name: /öffnen/ }).click();
  await ready(page);
  const original = await readWork(page);
  expect(original).toMatchObject({ style: 'orthogonal', detail: 'Minimal', display: 'Verlauf', lineWidth: '1,50', direction: 'reverse', speed: '2×', loop: 'Endlos' });
  expect(original.start).not.toBe('auto');

  // Export the project file (export step, "Projektdatei").
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(exportScreen(page)).toBeVisible();
  const file = await exportProjectFile(page);
  expect(file.fileName).toMatch(/^Hafen \d{4}-\d{2}-\d{2} \d{4}\.onelineart$/);
  expect(file.buffer.subarray(0, 10).toString('ascii')).toBe('ONELINEART');

  // Import on a "fresh start": a new project next to the original, nothing computed.
  await page.reload();
  await openGallery(page);
  await importProjectFile(page, file.fileName, file.buffer);
  await expect(page.getByTestId('project-import-done')).toContainText('„Hafen – Import“ wurde importiert');
  await expect(items(page)).toHaveCount(2);
  await expect(card(page, 'Hafen – Import').locator('.card__detail')).toContainText('Orthogonal');
  const ids = await items(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-project-id')));
  expect(new Set(ids).size).toBe(2);

  await card(page, 'Hafen – Import').getByRole('button', { name: /öffnen/ }).click();
  await ready(page);
  expect(await readWork(page)).toEqual(original);
  expect(await workers(page, 'pathGeneration')).toBe(0);
  expect(await workers(page, 'analysis')).toBe(0);

  // Edit and save the imported work; the original stays as it was.
  await page.getByRole('radio', { name: 'Einfarbig' }).click();
  await save(page);
  await openGallery(page);
  await card(page, 'Hafen').getByRole('button', { name: /öffnen/ }).click();
  await ready(page);
  expect(await checked(page, 'Darstellung').textContent()).toBe('Verlauf');
  await openGallery(page);
  await card(page, 'Hafen – Import').getByRole('button', { name: /öffnen/ }).click();
  await ready(page);
  expect(await checked(page, 'Darstellung').textContent()).toBe('Einfarbig');

  // Export the imported work again and import it once more: another new project.
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  const again = await exportProjectFile(page);
  expect(again.fileName).toMatch(/^Hafen – Import \d{4}-\d{2}-\d{2} \d{4}\.onelineart$/);
  await openGallery(page);
  await importProjectFile(page, again.fileName, again.buffer);
  await expect(items(page)).toHaveCount(3);
  await expect(card(page, 'Hafen – Import – Import')).toHaveCount(1);

  // Broken and unknown files: a clear message, nothing changes.
  await importProjectFile(page, 'kaputt.onelineart', Buffer.from('this is not a project'));
  await expect(page.getByTestId('project-import-error')).toContainText('Keine gültige Projektdatei');
  const truncated = file.buffer.subarray(0, file.buffer.length - 10);
  await importProjectFile(page, 'kurz.onelineart', Buffer.from(truncated));
  await expect(page.getByTestId('project-import-error')).toContainText('Keine gültige Projektdatei');
  const newer = Buffer.from(file.buffer);
  newer[10] = 99;
  await importProjectFile(page, 'neu.onelineart', newer);
  await expect(page.getByTestId('project-import-error')).toContainText('neueren App-Version');
  await expect(items(page)).toHaveCount(3);

  // Delete an imported work: the others (and the shared photo) stay.
  await card(page, 'Hafen – Import').getByRole('button', { name: 'Löschen' }).click();
  await page.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(items(page)).toHaveCount(2);
  await card(page, 'Hafen').getByRole('button', { name: /öffnen/ }).click();
  await ready(page);
  await openGallery(page);
  await expect(items(page)).toHaveCount(2);
  expect((await titles(page).allTextContents()).sort()).toEqual(['Hafen', 'Hafen – Import – Import']);
});

test('13.7 loop: the preview repeats from the start point; without loop it ends; no path is computed', async ({ page }) => {
  test.setTimeout(180_000);
  await createArtwork(page, { width: 800, height: 600 });
  await page.getByRole('radio', { name: 'Orthogonal' }).click();
  await ready(page);
  const paths = await workers(page, 'pathGeneration');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('radio', { name: '5 s', exact: true }).click();
  await openPanel(page);
  await radio(page, 'Geschwindigkeit', '4×').click(); // 1.25 s drawing + 2 s hold
  await radio(page, 'Richtung', 'Rückwärts').click();
  await pickStart(page, 0.7, 0.4);
  const start = await canvas(page).getAttribute('data-start');

  // Without loop: plays once and ends.
  await expect(checked(page, 'Wiederholen')).toHaveText('Einmal');
  await page.getByRole('button', { name: 'Abspielen' }).click();
  await expect(canvas(page)).toHaveAttribute('data-status', 'finished', { timeout: 10_000 });

  // With loop: after the hold it draws again (progress back below 1) and never finishes.
  await radio(page, 'Wiederholen', 'Endlos').click();
  await page.getByRole('button', { name: 'Von vorn' }).click();
  await expect(canvas(page)).toHaveAttribute('data-phase', 'hold', { timeout: 10_000 });
  await expect(canvas(page)).toHaveAttribute('data-phase', 'drawing', { timeout: 10_000 });
  await expect(canvas(page)).toHaveAttribute('data-phase', 'hold', { timeout: 10_000 });
  await expect(canvas(page)).toHaveAttribute('data-phase', 'drawing', { timeout: 10_000 });
  expect(await canvas(page).getAttribute('data-status')).toBe('playing');
  // Same start point and direction throughout.
  await expect(canvas(page)).toHaveAttribute('data-start', start!);
  await expect(canvas(page)).toHaveAttribute('data-direction', 'reverse');

  // Pause, resume, restart keep working with loop.
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(canvas(page)).toHaveAttribute('data-status', 'paused');
  const frozen = await canvas(page).getAttribute('data-position-ms');
  await page.waitForTimeout(400);
  expect(await canvas(page).getAttribute('data-position-ms')).toBe(frozen);
  await page.getByRole('button', { name: 'Abspielen' }).click();
  await expect(canvas(page)).toHaveAttribute('data-status', 'playing');
  await page.getByRole('button', { name: 'Von vorn' }).click();
  expect(Number(await canvas(page).getAttribute('data-position-ms'))).toBeLessThan(1500);

  // Loop off again: the next end is final.
  await radio(page, 'Wiederholen', 'Einmal').click();
  await expect(canvas(page)).toHaveAttribute('data-status', 'finished', { timeout: 10_000 });

  // Saved with the work, restored on reopening; nothing recomputed at any time.
  await radio(page, 'Wiederholen', 'Endlos').click();
  await save(page);
  expect(await workers(page, 'pathGeneration')).toBe(paths);
  await page.reload();
  await openGallery(page);
  await items(page).first().getByRole('button', { name: /öffnen/ }).click();
  await ready(page);
  await page.getByRole('button', { name: 'Weiter' }).click();
  await openPanel(page);
  await expect(checked(page, 'Wiederholen')).toHaveText('Endlos');
  await expect(canvas(page)).toHaveAttribute('data-start', start!);
  expect(await workers(page, 'pathGeneration')).toBe(0);
});

test('13.8 settings: defaults for new works, remembered after a restart; saved works keep their own values', async ({ page }) => {
  test.setTimeout(240_000);
  // A work saved BEFORE the defaults change: Organic, Balanced, white, 10 s, forward, once.
  await createArtwork(page, { width: 800, height: 600 });
  await save(page);

  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await expect(page.getByTestId('preferences-screen')).toBeVisible();
  await radio(page, 'Stil', 'Orthogonal').click();
  await radio(page, 'Detailgrad', 'Detail').click();
  await radio(page, 'Hintergrund', 'Schwarz').click();
  await page.getByRole('slider', { name: 'Linienbreite' }).focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Tab');
  await radio(page, 'Dauer', '15 s').click();
  await radio(page, 'Geschwindigkeit', '2×').click();
  await radio(page, 'Richtung', 'Rückwärts').click();
  await radio(page, 'Wiederholen', 'Endlos').click();
  await expect(page.getByRole('slider', { name: 'Linienbreite' })).toHaveAttribute('aria-valuetext', '1,50');

  // Remembered after a restart; Android back leaves the settings.
  await page.reload();
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await expect(checked(page, 'Stil')).toHaveText('Orthogonal');
  await expect(checked(page, 'Detailgrad')).toHaveText('Detail');
  await expect(checked(page, 'Hintergrund')).toHaveText('Schwarz');
  await expect(checked(page, 'Dauer')).toHaveText('15 s');
  await expect(checked(page, 'Wiederholen')).toHaveText('Endlos');
  expect(await page.evaluate(() => (window as unknown as { __systemBack: () => boolean }).__systemBack())).toBe(true);
  await expect(page.getByTestId('preferences-screen')).toBeHidden();

  // A NEW work starts with the defaults.
  await pickFile(page, 'Bild auswählen', { name: 'neu.jpg', mimeType: 'image/jpeg', buffer: await createImage(page, { layout: 'left-right', width: 600, height: 400 }) });
  await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await ready(page);
  await expect(settingsScreen(page)).toHaveAttribute('data-style', 'orthogonal');
  await expect(checked(page, 'Detailgrad')).toHaveText('Detail');
  await page.getByRole('button', { name: 'Anpassen' }).click();
  await radio(page, 'Bereich', 'Darstellung').click();
  await expect(page.getByRole('slider', { name: 'Linienbreite' })).toHaveAttribute('aria-valuetext', '1,50');
  await radio(page, 'Bereich', 'Farbe').click();
  await expect(checked(page, 'Hintergrundfarbe')).toHaveText('Schwarz');
  await page.getByRole('button', { name: 'Anpassen' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await openPanel(page);
  await expect(checked(page, 'Dauer')).toHaveText('15 s');
  await expect(checked(page, 'Geschwindigkeit')).toHaveText('2×');
  await expect(canvas(page)).toHaveAttribute('data-direction', 'reverse');
  await expect(checked(page, 'Wiederholen')).toHaveText('Endlos');

  // The work saved before keeps ALL its own values.
  await openGallery(page);
  await items(page).first().getByRole('button', { name: /öffnen/ }).click();
  await ready(page);
  await expect(settingsScreen(page)).toHaveAttribute('data-style', 'organic');
  await expect(checked(page, 'Detailgrad')).toHaveText('Balanced');
  await page.getByRole('button', { name: 'Anpassen' }).click();
  await radio(page, 'Bereich', 'Darstellung').click();
  await expect(page.getByRole('slider', { name: 'Linienbreite' })).toHaveAttribute('aria-valuetext', '1,00');
  await radio(page, 'Bereich', 'Farbe').click();
  await expect(checked(page, 'Hintergrundfarbe')).toHaveText('Weiß');
  await page.getByRole('button', { name: 'Anpassen' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await openPanel(page);
  await expect(checked(page, 'Dauer')).toHaveText('10 s');
  await expect(checked(page, 'Geschwindigkeit')).toHaveText('1×');
  await expect(canvas(page)).toHaveAttribute('data-direction', 'forward');
  await expect(checked(page, 'Wiederholen')).toHaveText('Einmal');
  // Changing the defaults again does not touch it either.
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await page.getByRole('button', { name: 'Auf Standard zurücksetzen' }).click();
  await expect(checked(page, 'Stil')).toHaveText('Organisch');
  await page.getByTestId('preferences-screen').getByRole('button', { name: 'Zurück', exact: true }).click();
  await openPanel(page);
  await expect(checked(page, 'Wiederholen')).toHaveText('Einmal');
  await expect(checked(page, 'Dauer')).toHaveText('10 s');
  await expect(page.getByTestId('save-project')).toHaveAttribute('data-save-status', 'saved');
});
