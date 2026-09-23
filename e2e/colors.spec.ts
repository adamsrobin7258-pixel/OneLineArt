import { expect, test, type Page } from '@playwright/test';
import { createArtwork, exportAndDownload, goToExport, imagePanel, probeVideo, settingsScreen, trackWorkers, videoPanel, workers } from './exportHelpers';

test.beforeEach(async ({ page }) => trackWorkers(page));

const colourSection = async (page: Page) => {
  if (!(await page.getByTestId('adjust-panel').isVisible())) await page.getByRole('button', { name: 'Anpassen' }).click();
  await page.getByRole('radiogroup', { name: 'Bereich' }).getByRole('radio', { name: 'Farbe' }).click();
};
const typeColor = async (page: Page, label: string, hex: string) => {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(hex);
  await field.press('Enter');
};
const back = async (page: Page) => {
  await page.getByRole('button', { name: 'Zurück' }).click();
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(settingsScreen(page)).toBeVisible();
};

/** Paper colour (corner) and the average colour of the line pixels of an exported PNG. */
const analyse = (page: Page, buffer: Buffer) =>
  page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const paper = [data[0]!, data[1]!, data[2]!];
    const sum = [0, 0, 0];
    let n = 0;
    const hues = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 3) {
      const d = Math.abs(data[i]! - paper[0]!) + Math.abs(data[i + 1]! - paper[1]!) + Math.abs(data[i + 2]! - paper[2]!);
      if (d < 150) continue;
      n++;
      for (let c = 0; c < 3; c++) sum[c]! += data[i + c]!;
      // Coarse hue bucket of strongly coloured pixels.
      const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max - min > 60) hues.add(max === r ? 0 : max === g ? 1 : 2);
    }
    return { paper, line: sum.map((v) => v / Math.max(1, n)), share: n / (data.length / 12), hues: [...hues].sort() };
  }, buffer.toString('base64'));

async function exportPng(page: Page) {
  await goToExport(page);
  await imagePanel(page).getByRole('radio', { name: '2048 px', exact: true }).click();
  return analyse(page, (await exportAndDownload(page, 'Bild')).buffer);
}

test('line colour, background colour, gradient, palette and intensity: rendering only, all in the export', async ({ page }) => {
  test.setTimeout(240_000);
  await createArtwork(page, { width: 800, height: 600 });
  const paths = await workers(page, 'pathGeneration');

  // Own line colour on cream paper.
  await colourSection(page);
  await typeColor(page, 'Linienfarbe', '#c0392b');
  await page.getByRole('radiogroup', { name: 'Hintergrundfarbe' }).getByRole('radio', { name: 'Eigene' }).click();
  await typeColor(page, 'Eigene Hintergrundfarbe', '#f3e9d2');
  await expect(page.getByText('Eigene Linienfarbe')).toBeVisible();
  const single = await exportPng(page);
  expect(single.paper).toEqual([243, 233, 210]);
  expect(single.line[0]!).toBeGreaterThan(single.line[2]! + 40); // red line
  expect(single.hues).toEqual([0]);

  // Gradient with a palette on black: several hues along the line.
  await back(page);
  await page.getByRole('radio', { name: 'Verlauf' }).click();
  await colourSection(page);
  await page.getByRole('radio', { name: 'Beere' }).click();
  await page.getByRole('radiogroup', { name: 'Hintergrundfarbe' }).getByRole('radio', { name: 'Schwarz' }).click();
  const gradient = await exportPng(page);
  expect(gradient.paper).toEqual([0, 0, 0]);
  expect(gradient.hues.length).toBeGreaterThanOrEqual(2);

  // Own start/end colours: no palette selected any more.
  await back(page);
  await colourSection(page);
  await typeColor(page, 'Startfarbe', '#00a000');
  await typeColor(page, 'Endfarbe', '#0000c0');
  await expect(page.getByText('Eigener Verlauf')).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Farbpalette' }).getByRole('radio', { checked: true })).toHaveCount(0);

  // Intensity 0: the same gradient in grey.
  await page.getByRole('slider', { name: 'Farbintensität' }).focus();
  await page.keyboard.press('Home');
  const grey = await exportPng(page);
  expect(grey.hues).toEqual([]);
  expect(grey.share).toBeGreaterThan(0.005);

  // Line width and drawing strength combine with the colours.
  await back(page);
  await page.getByRole('button', { name: 'Anpassen' }).click();
  await page.getByRole('radiogroup', { name: 'Bereich' }).getByRole('radio', { name: 'Darstellung' }).click();
  await page.getByRole('slider', { name: 'Linienbreite' }).focus();
  await page.keyboard.press('End');
  const wide = await exportPng(page);
  expect(wide.share).toBeGreaterThan(grey.share * 1.5);

  // Nothing of this recomputed the drawing or analysed the image again.
  expect(await workers(page, 'pathGeneration')).toBe(paths);
  expect(await workers(page, 'analysis')).toBe(1);
});

test('black/white and the lightness slider still work; switching colours keeps the drawing', async ({ page }) => {
  test.setTimeout(120_000);
  await createArtwork(page, { width: 800, height: 600 });
  const paths = await workers(page, 'pathGeneration');
  await colourSection(page);
  await expect(page.getByLabel('Linienfarbe', { exact: true })).toHaveValue('#000000');
  // Black paper → the black line turns white automatically.
  await page.getByRole('radiogroup', { name: 'Hintergrundfarbe' }).getByRole('radio', { name: 'Schwarz' }).click();
  await expect(page.getByLabel('Linienfarbe', { exact: true })).toHaveValue('#ffffff');
  await expect(page.getByText('Einfarbige Linie – auf dunklem Grund hell')).toBeVisible();
  // Lightness works on the chosen colour: lighter black = grey.
  await page.getByRole('radiogroup', { name: 'Bereich' }).getByRole('radio', { name: 'Darstellung' }).click();
  const slider = page.getByRole('slider', { name: 'Hintergrundhelligkeit' });
  await expect(slider).toHaveAttribute('aria-valuetext', '0 %');
  await slider.focus();
  await page.keyboard.press('End');
  await expect(slider).toHaveAttribute('aria-valuetext', '100 %');
  await colourSection(page);
  await expect(page.getByLabel('Linienfarbe', { exact: true })).toHaveValue('#000000');
  await page.getByRole('radiogroup', { name: 'Hintergrundfarbe' }).getByRole('radio', { name: 'Weiß' }).click();
  await expect(page.getByRole('button', { name: 'Zurücksetzen' })).toBeDisabled();
  expect(await workers(page, 'pathGeneration')).toBe(paths);
});

test('gradient: the animation finishes and the video export works', async ({ page }) => {
  test.setTimeout(180_000);
  await createArtwork(page, { width: 800, height: 600 });
  await page.getByRole('radio', { name: 'Verlauf' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  const canvas = page.getByTestId('animation-canvas');
  await page.getByRole('radio', { name: '5 s', exact: true }).click();
  await page.getByRole('button', { name: 'Abspielen' }).click();
  await expect(canvas).toHaveAttribute('data-status', 'finished', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await videoPanel(page).getByRole('radio', { name: '5 s', exact: true }).click();
  const video = await exportAndDownload(page, 'Video', 120_000);
  expect((await probeVideo(video.buffer)).durationS).toBeGreaterThan(6);
  expect(await workers(page, 'pathGeneration')).toBe(1);
});
