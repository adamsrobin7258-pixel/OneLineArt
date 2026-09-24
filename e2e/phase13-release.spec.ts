import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createArtwork, exportAndDownload, exportScreen, firstInkAround, imageDimensions, imagePanel, probeVideo, settingsScreen, trackWorkers, videoPanel, workers } from './exportHelpers';

/**
 * Phase 13.9 — release regression across 13.1–13.8 in ONE continuous work:
 * the whole user flow, the loop's second pass, and the new screens on every
 * relevant width. Only checks; the features themselves are covered in detail
 * by their own specs.
 */
test.beforeEach(async ({ page }) => trackWorkers(page));

const items = (page: Page) => page.getByTestId('gallery-item');
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
const point = (start: string) => {
  const [x, y] = start.split(',').map(Number) as [number, number];
  return { x, y };
};
/** Line pixels on the live preview canvas: count and nearest distance to `p` (normalized). */
const inkOnCanvas = (page: Page, p: { x: number; y: number }) =>
  canvas(page).evaluate((el: HTMLCanvasElement, p) => {
    const copy = document.createElement('canvas');
    copy.width = el.width;
    copy.height = el.height;
    const ctx = copy.getContext('2d')!;
    ctx.drawImage(el, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, copy.width, copy.height);
    let count = 0, nearest = Infinity;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! + data[i + 1]! + data[i + 2]! >= 300) continue;
      count++;
      const px = (i / 4) % width, py = Math.floor(i / 4 / width);
      nearest = Math.min(nearest, Math.hypot(px / width - p.x, py / height - p.y));
    }
    return { count, nearest };
  }, p);
/** Scrolls the control into view and checks that nothing else covers its centre. */
async function reachable(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeInViewport();
  const onTop = await control.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
  });
  expect(onTop, `${await control.textContent()} is covered`).toBe(true);
}
async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

test('13.9 whole workflow: photo → edit → Orthogonal/Detail → start point → animation → save → reopen → image, video, project file → import → reopen', async ({ page }) => {
  test.setTimeout(420_000);
  // 1–2. Import and edit (rotate right).
  await createArtwork(page, { width: 900, height: 700 });
  await page.getByRole('button', { name: 'Zurück' }).click();
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await page.getByRole('button', { name: 'Nach rechts drehen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-processing-size', '700x900');
  await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await ready(page);
  // 3–5. Style Orthogonal, level Detail → the one line.
  await page.getByRole('radio', { name: 'Orthogonal' }).click();
  await page.getByRole('radio', { name: 'Detail', exact: true }).click();
  await ready(page);
  await expect(settingsScreen(page)).toHaveAttribute('data-style', 'orthogonal');
  await expect(settingsScreen(page)).toHaveAttribute('data-render-size', '1593x2048');
  const paths = await workers(page, 'pathGeneration');
  const analyses = await workers(page, 'analysis');

  // 6–11. Start point, play, pause, direction, duration + speed, loop on/off/on.
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('radio', { name: '5 s', exact: true }).click();
  await pickStart(page, 0.35, 0.55);
  const start = (await canvas(page).getAttribute('data-start'))!;
  expect(start).not.toBe('auto');
  await page.getByRole('button', { name: 'Abspielen' }).click();
  await expect(canvas(page)).toHaveAttribute('data-status', 'playing');
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(canvas(page)).toHaveAttribute('data-status', 'paused');
  await radio(page, 'Richtung', 'Rückwärts').click();
  await radio(page, 'Geschwindigkeit', '2×').click();
  await radio(page, 'Wiederholen', 'Endlos').click();
  await radio(page, 'Wiederholen', 'Einmal').click();
  await radio(page, 'Wiederholen', 'Endlos').click();
  await expect(canvas(page)).toHaveAttribute('data-direction', 'reverse');
  await expect(canvas(page)).toHaveAttribute('data-start', start);
  expect(await workers(page, 'pathGeneration')).toBe(paths); // animation choices never recompute

  // 12–14. Save, name it, close (restart), reopen.
  await save(page);
  await openGallery(page);
  await items(page).first().getByRole('button', { name: 'Umbenennen' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Release');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await page.reload();
  await openGallery(page);
  await card(page, 'Release').getByRole('button', { name: /öffnen/ }).click();
  await ready(page);

  // 15. Every stored setting is back, nothing recomputed.
  await expect(settingsScreen(page)).toHaveAttribute('data-style', 'orthogonal');
  await expect(settingsScreen(page)).toHaveAttribute('data-render-size', '1593x2048');
  await expect(checked(page, 'Detailgrad')).toHaveText('Detail');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await openPanel(page);
  await expect(checked(page, 'Dauer')).toHaveText('5 s');
  await expect(checked(page, 'Geschwindigkeit')).toHaveText('2×');
  await expect(checked(page, 'Richtung')).toHaveText('Rückwärts');
  await expect(checked(page, 'Wiederholen')).toHaveText('Endlos');
  await expect(canvas(page)).toHaveAttribute('data-start', start);
  expect(await workers(page, 'pathGeneration')).toBe(0);
  expect(await workers(page, 'analysis')).toBe(0);

  // 16. Image: current work, safe name, exact size of the edited (portrait) artwork.
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(exportScreen(page)).toBeVisible();
  await imagePanel(page).getByRole('radio', { name: '2048 px', exact: true }).click();
  const image = await exportAndDownload(page, 'Bild');
  expect(image.fileName).toMatch(/^Release \d{4}-\d{2}-\d{2} \d{4}\.png$/);
  expect(imageDimensions(image.buffer)).toMatchObject({ format: 'png', width: 1593, height: 2048 });

  // 17. Video: ONE drawing despite "Endlos" (5 s ÷ 2 = 2.5 s + 2 s hold), starting at the start point.
  await videoPanel(page).getByRole('radio', { name: '1080p' }).click();
  const video = await exportAndDownload(page, 'Video', 120_000);
  expect(video.fileName).toMatch(/^Release \d{4}-\d{2}-\d{2} \d{4}\.(mp4|webm)$/);
  const probe = await probeVideo(video.buffer);
  expect(probe.frames).toBe(Math.round(4.5 * 30) + 1);
  expect(probe.durationS).toBeCloseTo(4.5, 0);
  const ink = await firstInkAround(page, video.buffer, point(start));
  expect(ink).not.toBeNull();
  expect(ink!.nearest).toBeLessThan(0.02);

  // 18. Project file.
  await page.getByRole('button', { name: 'Projektdatei exportieren' }).click();
  const fileReady = page.getByTestId('project-file-ready');
  await expect(fileReady).toBeVisible({ timeout: 30_000 });
  const fileName = (await fileReady.getAttribute('data-file-name'))!;
  expect(fileName).toMatch(/^Release \d{4}-\d{2}-\d{2} \d{4}\.onelineart$/);
  const downloading = page.waitForEvent('download');
  await fileReady.getByRole('button', { name: 'Herunterladen' }).click();
  const projectFile = await readFile((await (await downloading).path())!);
  expect(await workers(page, 'pathGeneration')).toBe(0); // exports never recompute

  // 19. Import: a new work next to the original, which stays untouched.
  await openGallery(page);
  await page.getByTestId('project-import-input').setInputFiles({ name: fileName, mimeType: 'application/octet-stream', buffer: projectFile });
  await expect(page.getByTestId('project-import-done')).toContainText('„Release – Import“ wurde importiert');
  await expect(items(page)).toHaveCount(2);
  await expect(card(page, 'Release')).toHaveCount(1);

  // 20. The imported work: same drawing, settings and start point; its video starts there too.
  await card(page, 'Release – Import').getByRole('button', { name: /öffnen/ }).click();
  await ready(page);
  await expect(settingsScreen(page)).toHaveAttribute('data-style', 'orthogonal');
  await expect(settingsScreen(page)).toHaveAttribute('data-render-size', '1593x2048');
  await expect(checked(page, 'Detailgrad')).toHaveText('Detail');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await openPanel(page);
  await expect(canvas(page)).toHaveAttribute('data-start', start);
  await expect(canvas(page)).toHaveAttribute('data-direction', 'reverse');
  await expect(checked(page, 'Wiederholen')).toHaveText('Endlos');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await videoPanel(page).getByRole('radio', { name: '1080p' }).click();
  const again = await exportAndDownload(page, 'Video', 120_000);
  expect((await probeVideo(again.buffer)).frames).toBe(probe.frames);
  expect((await firstInkAround(page, again.buffer, point(start)))!.nearest).toBeLessThan(0.02);
  expect(await workers(page, 'pathGeneration')).toBe(0);
  expect(await workers(page, 'analysis')).toBe(0);
  expect(paths + analyses).toBeGreaterThan(0);
});

test('13.9 loop: the second pass starts again at the stored start point, on a cleared canvas, without a new path', async ({ page }) => {
  test.setTimeout(180_000);
  await createArtwork(page, { width: 800, height: 600 });
  await page.getByRole('radio', { name: 'Orthogonal' }).click();
  await ready(page);
  const paths = await workers(page, 'pathGeneration');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('radio', { name: '30 s', exact: true }).click();
  await openPanel(page);
  await radio(page, 'Geschwindigkeit', '4×').click(); // 7.5 s drawing + 2 s hold
  await pickStart(page, 0.6, 0.4);
  const start = point((await canvas(page).getAttribute('data-start'))!);
  await radio(page, 'Wiederholen', 'Endlos').click();

  await page.getByRole('button', { name: 'Abspielen' }).click();
  await expect(canvas(page)).toHaveAttribute('data-phase', 'hold', { timeout: 20_000 });
  const complete = await inkOnCanvas(page, start);
  // Second pass: stop right after it began.
  await page.waitForFunction(() => document.querySelector('[data-testid=animation-canvas]')?.getAttribute('data-phase') === 'drawing', null, { timeout: 10_000, polling: 'raf' });
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(canvas(page)).toHaveAttribute('data-status', 'paused');
  expect(Number(await canvas(page).getAttribute('data-position-ms'))).toBeLessThan(2_000);
  const early = await inkOnCanvas(page, start);
  expect(early.count).toBeGreaterThan(0);
  expect(early.count).toBeLessThan(complete.count * 0.4); // the canvas was cleared, not drawn over
  expect(early.nearest).toBeLessThan(0.02); // it begins at the start point again
  expect(await workers(page, 'pathGeneration')).toBe(paths);
});

for (const width of [360, 390, 430, 768, 1024, 1280]) {
  test(`13.9 responsive ${width} px: gallery tools, settings, start point, loop and project file reachable, nothing covered`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: width < 500 ? 800 : 900 });
    await createArtwork(page, { width: 900, height: 600 });
    await noHorizontalOverflow(page);
    await reachable(page.getByRole('radio', { name: 'Orthogonal' }));
    await page.getByRole('radio', { name: 'Orthogonal' }).click();
    await ready(page);

    // Animation: start point and loop.
    await page.getByRole('button', { name: 'Weiter' }).click();
    await noHorizontalOverflow(page);
    await pickStart(page, 0.5, 0.5);
    await reachable(radio(page, 'Wiederholen', 'Endlos'));
    await reachable(page.getByRole('button', { name: 'Abspielen' }));

    // Export: image, video and the project file.
    await page.getByRole('button', { name: 'Weiter' }).click();
    await noHorizontalOverflow(page);
    for (const label of ['Bild exportieren', 'Video exportieren', 'Projektdatei exportieren']) await reachable(page.getByRole('button', { name: label }));
    await page.getByRole('button', { name: 'Projektdatei exportieren' }).click();
    await expect(page.getByTestId('project-file-ready')).toBeVisible({ timeout: 30_000 });
    await reachable(page.getByTestId('project-file-ready').getByRole('button', { name: 'Herunterladen' }));
    await noHorizontalOverflow(page);

    // Gallery: search, order, favourites, import.
    await save(page);
    await openGallery(page);
    await noHorizontalOverflow(page);
    await reachable(page.getByRole('searchbox', { name: 'Werke durchsuchen' }));
    for (const option of ['Geändert', 'Erstellt', 'A–Z']) await reachable(radio(page, 'Sortierung', option));
    await reachable(radio(page, 'Anzeigen', 'Favoriten'));
    await reachable(page.getByRole('button', { name: 'Werk importieren' }).first());
    for (const action of [/öffnen/, 'Umbenennen', 'Löschen']) await reachable(items(page).first().getByRole('button', { name: action }).first());

    // Settings screen (from the work's header, as in the app).
    await items(page).first().getByRole('button', { name: /öffnen/ }).click();
    await ready(page);
    await page.getByRole('button', { name: 'Einstellungen' }).click();
    await expect(page.getByTestId('preferences-screen')).toBeVisible();
    await noHorizontalOverflow(page);
    for (const [group, option] of [['Stil', 'Orthogonal'], ['Detailgrad', 'Detail'], ['Hintergrund', 'Schwarz'], ['Richtung', 'Rückwärts'], ['Wiederholen', 'Endlos']] as const) await reachable(radio(page, group, option));
    await reachable(page.getByRole('slider', { name: 'Linienbreite' }));
    await reachable(page.getByRole('button', { name: 'Auf Standard zurücksetzen' }));
  });
}
