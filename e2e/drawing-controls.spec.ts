import { expect, test, type Page } from '@playwright/test';
import { colourfulness, createArtwork, exportAndDownload, exportScreen, goToExport, imagePanel, probeVideo, settingsScreen, trackWorkers, videoPanel, workers } from './exportHelpers';
import { createImage, pickFile } from './helpers';

test.beforeEach(async ({ page }) => trackWorkers(page));

const expectDrawing = (page: Page) => expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
const openAdjust = async (page: Page) => {
  await page.getByRole('button', { name: 'Anpassen' }).click();
  await expect(page.getByTestId('adjust-panel')).toBeVisible();
};
/** Shows one section of the "Anpassen" panel (Linie | Darstellung | Farbe). */
const section = (page: Page, name: 'Linie' | 'Darstellung' | 'Farbe') => page.getByRole('radiogroup', { name: 'Bereich' }).getByRole('radio', { name }).click();
/** Moves a slider with the keyboard (like a user) and releases it. */
async function slide(page: Page, name: string, keys: string[]) {
  await page.getByRole('slider', { name }).focus();
  for (const key of keys) await page.keyboard.press(key);
}

/** Share of pixels that differ clearly from the paper (corner pixel), and the paper brightness. */
const inkOnPaper = (page: Page, buffer: Buffer) =>
  page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const paper = (data[0]! + data[1]! + data[2]!) / 3;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4 * 5) if (Math.abs((data[i]! + data[i + 1]! + data[i + 2]!) / 3 - paper) > 60) ink++;
    return { paper, ink: ink / (data.length / 20) };
  }, buffer.toString('base64'));

test('style: Organic by default; Geometric draws its own line; switching back is instant', async ({ page }) => {
  test.setTimeout(120_000);
  await createArtwork(page, { width: 900, height: 700 });
  const style = page.getByRole('radiogroup', { name: 'Stil' });
  await expect(style.getByRole('radio')).toHaveText(['Organisch', 'Geometrisch', 'Orthogonal']);
  await expect(style.getByRole('radio', { name: 'Organisch' })).toHaveAttribute('aria-checked', 'true');
  await expect(settingsScreen(page)).toHaveAttribute('data-engine', 'importance-stipple-tour');

  await style.getByRole('radio', { name: 'Geometrisch' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-style', 'geometric');
  await expect(settingsScreen(page)).toHaveAttribute('data-engine', 'geometric-stipple-tour');
  await expectDrawing(page);
  await expect(page.getByText('Gerade Linien mit klaren Ecken')).toBeVisible();
  expect(await workers(page, 'pathGeneration')).toBe(2);

  await style.getByRole('radio', { name: 'Organisch' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready');
  expect(await workers(page, 'pathGeneration')).toBe(2); // cached
  expect(await workers(page, 'analysis')).toBe(1);
});

test('detail slider: custom state "Eigene", presets restore; smoothing only in the organic style', async ({ page }) => {
  test.setTimeout(120_000);
  await createArtwork(page, { width: 900, height: 700 });
  const detail = page.getByRole('radiogroup', { name: 'Detailgrad' });
  await openAdjust(page);
  await expect(page.getByRole('slider', { name: 'Detailgrad' })).toHaveAttribute('aria-valuetext', '50 %');

  // Five steps up: a value between Balanced and Detail → "Eigene", one new line.
  await slide(page, 'Detailgrad', ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight']);
  await expect(settingsScreen(page)).toHaveAttribute('data-detail-custom', 'true');
  await expect(detail.getByRole('radio', { name: 'Eigene' })).toHaveAttribute('aria-checked', 'true');
  await expectDrawing(page);
  // Committed per key release: at most one computation per step, the last one wins.
  expect(await workers(page, 'pathGeneration')).toBeLessThanOrEqual(6);
  await expect(page.getByRole('slider', { name: 'Detailgrad' })).toHaveAttribute('aria-valuetext', '55 %');

  // Smoothing changes the line too.
  const before = await workers(page, 'pathGeneration');
  await slide(page, 'Linienglättung', ['End']);
  await expect(page.getByRole('slider', { name: 'Linienglättung' })).toHaveAttribute('aria-valuetext', '5');
  await expectDrawing(page);
  expect(await workers(page, 'pathGeneration')).toBe(before + 1);

  // A preset restores everything (cached Balanced line, no new computation).
  const computed = await workers(page, 'pathGeneration');
  await detail.getByRole('radio', { name: 'Balanced' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-detail-custom', 'false');
  await expect(detail.getByRole('radio')).toHaveText(['Minimal', 'Balanced', 'Detail']);
  await expect(page.getByRole('slider', { name: 'Linienglättung' })).toHaveAttribute('aria-valuetext', '2');
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready');
  expect(await workers(page, 'pathGeneration')).toBe(computed);

  // Geometric: straight lines, no smoothing.
  await page.getByRole('button', { name: 'Anpassen' }).click(); // close
  await page.getByRole('radio', { name: 'Geometrisch' }).click();
  await openAdjust(page);
  await expect(page.getByRole('slider', { name: 'Linienglättung' })).toBeDisabled();
  await expect(page.getByText('Im geometrischen Stil bleiben die Linien gerade')).toBeVisible();
  expect(await workers(page, 'analysis')).toBe(1);
});

test('render controls change only the drawing of the same line and reach the export', async ({ page }) => {
  test.setTimeout(180_000);
  await createArtwork(page, { width: 800, height: 600 });
  await goToExport(page);
  await imagePanel(page).getByRole('radio', { name: '2048 px', exact: true }).click();
  const plain = await inkOnPaper(page, (await exportAndDownload(page, 'Bild')).buffer);
  await page.getByRole('button', { name: 'Zurück' }).click();
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expectDrawing(page);
  const paths = await workers(page, 'pathGeneration');

  await openAdjust(page);
  await section(page, 'Darstellung');
  await slide(page, 'Linienbreite', ['End']);
  await expect(page.getByRole('slider', { name: 'Linienbreite' })).toHaveAttribute('aria-valuetext', '4,00');
  await slide(page, 'Zeichenstärke', ['ArrowLeft', 'ArrowLeft']);
  await expect(page.getByRole('slider', { name: 'Zeichenstärke' })).toHaveAttribute('aria-valuetext', '90 %');
  // One colour intensity for every colour mode (phase 12.2).
  await section(page, 'Farbe');
  await page.getByRole('radio', { name: 'Foto' }).click();
  await expect(page.getByRole('slider', { name: 'Farbintensität' })).toBeEnabled();
  await slide(page, 'Farbintensität', ['Home']);
  await expect(page.getByRole('slider', { name: 'Farbintensität' })).toHaveAttribute('aria-valuetext', '0 %');
  await page.getByRole('radio', { name: 'Einfarbig' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready');
  // Nothing of this recomputes the line or the analysis.
  expect(await workers(page, 'pathGeneration')).toBe(paths);
  expect(await workers(page, 'analysis')).toBe(1);

  await goToExport(page);
  await imagePanel(page).getByRole('radio', { name: '2048 px', exact: true }).click();
  const wide = await inkOnPaper(page, (await exportAndDownload(page, 'Bild')).buffer);
  expect(wide.paper).toBeGreaterThan(250);
  expect(wide.ink).toBeGreaterThan(plain.ink * 1.5); // 4× line width

  // Dark paper: the export follows, the line turns light.
  await page.getByRole('button', { name: 'Zurück' }).click();
  await page.getByRole('button', { name: 'Zurück' }).click();
  await openAdjust(page);
  await section(page, 'Darstellung');
  await slide(page, 'Hintergrundhelligkeit', ['Home']);
  await expect(page.getByText('Einfarbige Linie – auf dunklem Grund hell')).toBeVisible();
  await goToExport(page);
  const png = (await exportAndDownload(page, 'Bild')).buffer;
  const dark = await inkOnPaper(page, png);
  expect(dark.paper).toBeLessThan(5);
  expect(dark.ink).toBeGreaterThan(0.02);
  expect((await colourfulness(page, png, 'image/png')).coloured).toBeLessThan(0.02);
  expect(await workers(page, 'pathGeneration')).toBe(paths);

  // Reset restores the defaults.
  await page.getByRole('button', { name: 'Zurück' }).click();
  await page.getByRole('button', { name: 'Zurück' }).click();
  await openAdjust(page);
  await page.getByRole('button', { name: 'Zurücksetzen' }).click();
  await section(page, 'Darstellung');
  await expect(page.getByRole('slider', { name: 'Linienbreite' })).toHaveAttribute('aria-valuetext', '1,00');
  await expect(page.getByRole('slider', { name: 'Hintergrundhelligkeit' })).toHaveAttribute('aria-valuetext', '100 %');
  await expect(page.getByRole('button', { name: 'Zurücksetzen' })).toBeDisabled();
});

test('geometric style: animation finishes, image and video export work', async ({ page }) => {
  test.setTimeout(240_000);
  await createArtwork(page, { width: 800, height: 600 });
  await page.getByRole('radio', { name: 'Geometrisch' }).click();
  await expectDrawing(page);
  const paths = await workers(page, 'pathGeneration');

  await page.getByRole('button', { name: 'Weiter' }).click();
  const canvas = page.getByTestId('animation-canvas');
  await expect(canvas).toHaveAttribute('data-status', 'ready');
  await page.getByRole('radio', { name: '5 s', exact: true }).click();
  await page.getByRole('button', { name: 'Abspielen' }).click();
  await expect(canvas).toHaveAttribute('data-status', 'finished', { timeout: 20_000 });
  expect(Number(await canvas.getAttribute('data-progress'))).toBe(1);

  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(exportScreen(page)).toBeVisible();
  await imagePanel(page).getByRole('radio', { name: '2048 px', exact: true }).click();
  const image = await exportAndDownload(page, 'Bild');
  expect((await inkOnPaper(page, image.buffer)).ink).toBeGreaterThan(0.01);

  await videoPanel(page).getByRole('radio', { name: '5 s', exact: true }).click();
  const video = await exportAndDownload(page, 'Video', 120_000);
  const probe = await probeVideo(video.buffer);
  expect(probe.width).toBeGreaterThan(0);
  expect(probe.durationS).toBeGreaterThan(6);
  expect(await workers(page, 'pathGeneration')).toBe(paths);
});

/** The stored paths of all saved projects (IndexedDB "paths" store): per path the segments that are not axis-parallel. */
const storedPaths = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ points: number; diagonal: number; zero: number }[]>((resolve, reject) => {
        const open = indexedDB.open('one-line-art');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction('paths').objectStore('paths').getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () =>
            resolve(
              (all.result as { coords: Float32Array }[]).map(({ coords }) => {
                let diagonal = 0, zero = 0;
                for (let i = 2; i < coords.length; i += 2) {
                  const dx = coords[i]! - coords[i - 2]!, dy = coords[i + 1]! - coords[i - 1]!;
                  if (dx !== 0 && dy !== 0) diagonal++;
                  if (dx === 0 && dy === 0) zero++;
                }
                return { points: coords.length / 2, diagonal, zero };
              }),
            );
        };
      }),
  );

test('orthogonal style: its own line with only horizontal and vertical segments, through edit, detail, colour, animation, export and projects', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await pickFile(page, 'Bild auswählen', { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: await createImage(page, { layout: 'left-right', width: 900, height: 600 }) });
  await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  // Image edit first: the orthogonal line is computed on the edited image.
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await page.getByRole('button', { name: 'Nach rechts drehen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expectDrawing(page);

  // Style change → a new line from the orthogonal engine.
  const before = await workers(page, 'pathGeneration');
  await page.getByRole('radiogroup', { name: 'Stil' }).getByRole('radio', { name: 'Orthogonal' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-style', 'orthogonal');
  await expect(settingsScreen(page)).toHaveAttribute('data-engine', 'orthogonal-stipple-tour');
  await expectDrawing(page);
  await expect(page.getByText('Nur waagerechte und senkrechte Linien, rechte Winkel')).toBeVisible();
  expect(await workers(page, 'pathGeneration')).toBe(before + 1);

  // Detail level: a new orthogonal line; smoothing does not apply.
  await page.getByRole('radiogroup', { name: 'Detailgrad' }).getByRole('radio', { name: 'Detail' }).click();
  await expectDrawing(page);
  await expect(settingsScreen(page)).toHaveAttribute('data-engine', 'orthogonal-stipple-tour');
  const paths = await workers(page, 'pathGeneration');
  expect(paths).toBe(before + 2);
  await openAdjust(page);
  await expect(page.getByRole('slider', { name: 'Linienglättung' })).toBeDisabled();
  await expect(page.getByText('Im orthogonalen Stil bleiben die Linien gerade')).toBeVisible();
  // Line width and colours only change how the same line is drawn.
  await section(page, 'Darstellung');
  await slide(page, 'Linienbreite', ['End']);
  await page.getByRole('button', { name: 'Anpassen' }).click(); // close
  await page.getByRole('radiogroup', { name: 'Darstellung' }).getByRole('radio', { name: 'Verlauf' }).click();
  await expectDrawing(page);

  // Animation with a start point: plays the same line, nothing recomputed.
  await page.getByRole('button', { name: 'Weiter' }).click();
  const canvas = page.getByTestId('animation-canvas');
  await page.getByRole('button', { name: 'Wiedergabe' }).click();
  await page.getByRole('button', { name: 'Startpunkt setzen' }).click();
  const box = (await page.getByTestId('start-picker').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.6);
  await expect(page.getByTestId('start-marker')).toBeVisible();
  const start = await canvas.getAttribute('data-start');
  expect(start).not.toBe('auto');
  await page.getByRole('radio', { name: '5 s', exact: true }).click();
  await page.getByRole('button', { name: 'Abspielen' }).click();
  await expect(canvas).toHaveAttribute('data-status', 'finished', { timeout: 20_000 });

  // Export: image and video.
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(exportScreen(page)).toBeVisible();
  await imagePanel(page).getByRole('radio', { name: '2048 px', exact: true }).click();
  expect((await colourfulness(page, (await exportAndDownload(page, 'Bild')).buffer, 'image/png')).line).toBeGreaterThan(0.01);
  const video = await probeVideo((await exportAndDownload(page, 'Video', 120_000)).buffer);
  expect(video.durationS).toBeGreaterThan(6);
  expect(await workers(page, 'pathGeneration')).toBe(paths);

  // Project: the stored line is exactly orthogonal; the gallery names the style.
  await page.getByTestId('save-project').click();
  await expect(page.getByTestId('save-project')).toHaveAttribute('data-save-status', 'saved');
  const stored = await storedPaths(page);
  expect(stored).toHaveLength(1);
  expect(stored[0]!.points).toBeGreaterThan(100);
  expect(stored[0]).toMatchObject({ diagonal: 0, zero: 0 });

  // Restart and reopen: same style, same start point, no computation; a style change computes again.
  await page.reload();
  await page.getByRole('button', { name: 'Meine Werke' }).click();
  await expect(page.getByTestId('gallery-item').first()).toContainText('Orthogonal');
  await page.getByTestId('gallery-item').first().getByRole('button', { name: /öffnen/ }).click();
  await expectDrawing(page);
  await expect(settingsScreen(page)).toHaveAttribute('data-style', 'orthogonal');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(canvas).toHaveAttribute('data-start', start!);
  expect(await workers(page, 'pathGeneration')).toBe(0);
  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'Stil' }).getByRole('radio', { name: 'Organisch' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-engine', 'importance-stipple-tour');
  await expectDrawing(page);
  expect(await workers(page, 'pathGeneration')).toBe(1);
});
