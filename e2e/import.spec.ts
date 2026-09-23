import { expect, test } from '@playwright/test';
import { colorAt, createImage, drawnImageBox, expectReady, isBlue, isRed, pickFile, status } from './helpers';

test.beforeEach(async ({ page }) => {
  // Count released bitmaps to verify temporary image data is freed.
  await page.addInitScript(() => {
    const w = window as unknown as { __closedBitmaps: number };
    w.__closedBitmaps = 0;
    const close = ImageBitmap.prototype.close;
    ImageBitmap.prototype.close = function () {
      w.__closedBitmaps++;
      close.call(this);
    };
  });
  await page.goto('/');
  await expect(status(page)).toHaveAttribute('data-status', 'empty');
});

const toolbar = (page: import('@playwright/test').Page) => page.getByTestId('image-toolbar');

test('imports a normal JPG', async ({ page }) => {
  const buffer = await createImage(page, { width: 1200, height: 800, layout: 'left-right' });
  await pickFile(page, 'Bild auswählen', { name: 'foto.jpg', mimeType: 'image/jpeg', buffer });
  await expectReady(page);
  await expect(toolbar(page)).toContainText('1200 × 800 · JPG');
  await expect(toolbar(page)).toHaveAttribute('data-processing-size', '1200x800');
  expect(isRed(await colorAt(page, 0.25, 0.5))).toBe(true);
  expect(isBlue(await colorAt(page, 0.75, 0.5))).toBe(true);
});

test('imports a PNG', async ({ page }) => {
  const buffer = await createImage(page, { width: 640, height: 480, type: 'image/png', color: '#00ff00' });
  await pickFile(page, 'Bild auswählen', { name: 'grafik.png', mimeType: 'image/png', buffer });
  await expectReady(page);
  await expect(toolbar(page)).toContainText('640 × 480 · PNG');
});

test('imports a very large image (48 MP) and scales the working copy', async ({ page }) => {
  const buffer = await createImage(page, { width: 8000, height: 6000, layout: 'left-right' });
  const started = Date.now();
  await pickFile(page, 'Bild auswählen', { name: 'gross.jpg', mimeType: 'image/jpeg', buffer });
  await expect(status(page)).toHaveAttribute('data-status', /loading|processing|ready/);
  await expectReady(page);
  expect(Date.now() - started).toBeLessThan(15_000);
  await expect(toolbar(page)).toHaveAttribute('data-image-size', '8000x6000');
  await expect(toolbar(page)).toHaveAttribute('data-processing-size', '2048x1536');
  const box = await drawnImageBox(page);
  expect(box.width / box.height).toBeCloseTo(8000 / 6000, 1);
});

for (const [name, width, height] of [
  ['portrait 9:16', 900, 1600],
  ['portrait 3:4', 1200, 1600],
  ['landscape 16:9', 1600, 900],
  ['landscape 4:3', 1600, 1200],
  ['square 1:1', 1000, 1000],
] as const) {
  test(`shows a ${name} image undistorted and fitted`, async ({ page }) => {
    const buffer = await createImage(page, { width, height });
    await pickFile(page, 'Bild auswählen', { name: 'bild.jpg', mimeType: 'image/jpeg', buffer });
    await expectReady(page);
    await expect(toolbar(page)).toHaveAttribute('data-image-size', `${width}x${height}`);
    const box = await drawnImageBox(page);
    // Undistorted: same aspect ratio within 1 pixel of rounding.
    expect(Math.abs(box.width / box.height - width / height)).toBeLessThan((2 / Math.min(box.width, box.height)) * (width / height));
    // Fitted: fills one axis of the viewer completely.
    expect(box.width === box.canvasWidth || box.height === box.canvasHeight).toBe(true);
  });
}

test('applies EXIF orientation (rotated phone photo appears upright)', async ({ page }) => {
  // Stored landscape: left red / right blue. EXIF 6 = rotate 90° clockwise → portrait, red on top.
  const buffer = await createImage(page, { width: 400, height: 200, layout: 'left-right', exifOrientation: 6 });
  await pickFile(page, 'Bild auswählen', { name: 'hochformat.jpg', mimeType: 'image/jpeg', buffer });
  await expectReady(page);
  await expect(toolbar(page)).toHaveAttribute('data-image-size', '200x400');
  await expect(toolbar(page)).toHaveAttribute('data-processing-size', '200x400');
  await expect(toolbar(page)).toHaveAttribute('data-orientation', '6');
  expect(isRed(await colorAt(page, 0.5, 0.25))).toBe(true);
  expect(isBlue(await colorAt(page, 0.5, 0.75))).toBe(true);
});

test.describe('errors are explained without technical details', () => {
  const cases = [
    { name: 'text file named .jpg', file: 'notiz.jpg', bytes: Buffer.from('Einkaufsliste: Milch, Brot'), message: 'Diese Datei ist kein Bild' },
    { name: 'GIF', file: 'anim.gif', bytes: Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00', 'latin1'), message: 'Dieses Format wird nicht unterstützt' },
    {
      name: 'damaged JPEG',
      file: 'kaputt.jpg',
      bytes: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(200, 0x13)]),
      message: 'Das Bild lässt sich nicht öffnen',
    },
    {
      name: 'HEIC the browser cannot decode',
      file: 'IMG_0001.HEIC',
      bytes: Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic\0\0\0\0mif1heic'), Buffer.alloc(100)]),
      message: 'HEIC-Fotos kann dieser Browser nicht öffnen',
    },
  ];
  for (const c of cases) {
    test(c.name, async ({ page }) => {
      await pickFile(page, 'Bild auswählen', { name: c.file, mimeType: 'application/octet-stream', buffer: c.bytes });
      await expect(status(page)).toHaveAttribute('data-status', 'error');
      const alert = page.getByRole('alert');
      await expect(alert).toContainText(c.message);
      await expect(alert).not.toContainText(/\b(\w*Error|\w*Exception|undefined|null)\b|\bat \S+:\d+|stack/);
      // Recover by choosing another image.
      const buffer = await createImage(page, { width: 300, height: 200 });
      await pickFile(page, 'Anderes Bild wählen', { name: 'ok.jpg', mimeType: 'image/jpeg', buffer });
      await expectReady(page);
    });
  }
});

test('replacing the image discards the old one completely', async ({ page }) => {
  const red = await createImage(page, { width: 800, height: 600, color: '#ff0000' });
  const blue = await createImage(page, { width: 600, height: 900, color: '#0000ff' });
  await pickFile(page, 'Bild auswählen', { name: 'rot.jpg', mimeType: 'image/jpeg', buffer: red });
  await expectReady(page);
  expect(isRed(await colorAt(page, 0.5, 0.5))).toBe(true);
  const closedBefore = await page.evaluate(() => (window as unknown as { __closedBitmaps: number }).__closedBitmaps);

  await pickFile(page, 'Anderes Bild', { name: 'blau.jpg', mimeType: 'image/jpeg', buffer: blue });
  await expectReady(page);
  await expect(toolbar(page)).toContainText('600 × 900');
  expect(isBlue(await colorAt(page, 0.5, 0.5))).toBe(true);
  expect(isBlue(await colorAt(page, 0.05, 0.05))).toBe(true);
  // The previous preview bitmap was released.
  const closedAfter = await page.evaluate(() => (window as unknown as { __closedBitmaps: number }).__closedBitmaps);
  expect(closedAfter).toBeGreaterThan(closedBefore);
});

test('removing the image returns to the empty state without leftovers', async ({ page }) => {
  const buffer = await createImage(page, { width: 800, height: 600, color: '#ff0000' });
  await pickFile(page, 'Bild auswählen', { name: 'rot.jpg', mimeType: 'image/jpeg', buffer });
  await expectReady(page);
  const closedBefore = await page.evaluate(() => (window as unknown as { __closedBitmaps: number }).__closedBitmaps);

  await page.getByRole('button', { name: 'Bild entfernen' }).click();
  await expect(status(page)).toHaveAttribute('data-status', 'empty');
  await expect(page.getByTestId('import-area')).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByText('800 × 600')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __closedBitmaps: number }).__closedBitmaps)).toBeGreaterThan(closedBefore);
});

test('cancelling the picker changes nothing (empty and with an image)', async ({ page }) => {
  await pickFile(page, 'Bild auswählen', null);
  await expect(status(page)).toHaveAttribute('data-status', 'empty');
  await expect(page.getByRole('alert')).toHaveCount(0);

  const buffer = await createImage(page, { width: 800, height: 600, color: '#ff0000' });
  await pickFile(page, 'Bild auswählen', { name: 'rot.jpg', mimeType: 'image/jpeg', buffer });
  await expectReady(page);
  await pickFile(page, 'Anderes Bild', null);
  await expectReady(page);
  await expect(toolbar(page)).toContainText('800 × 600');
  expect(isRed(await colorAt(page, 0.5, 0.5))).toBe(true);
});

test('zoom and pan are preview-only', async ({ page }) => {
  const buffer = await createImage(page, { width: 1600, height: 1200, layout: 'left-right' });
  await pickFile(page, 'Bild auswählen', { name: 'zoom.jpg', mimeType: 'image/jpeg', buffer });
  await expectReady(page);
  const viewer = page.getByTestId('image-viewer');
  const box = (await viewer.boundingBox())!;

  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await page.mouse.wheel(0, -600);
  await expect(page.getByRole('button', { name: 'Einpassen' })).toBeVisible();
  // Zoomed in on the left (red) half: the whole viewport is now red.
  expect(isRed(await page.getByTestId('image-viewer').locator('canvas').evaluate((c: HTMLCanvasElement) =>
    Array.from(c.getContext('2d')!.getImageData(5, 5, 1, 1).data.slice(0, 3))))).toBe(true);

  // Drag to pan, then fit again.
  await page.mouse.down();
  await page.mouse.move(box.x + 50, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Einpassen' }).click();
  await expect(page.getByRole('button', { name: 'Einpassen' })).toHaveCount(0);

  // Processing data is unaffected by zoom.
  await expect(toolbar(page)).toHaveAttribute('data-processing-size', '1600x1200');
});

test('later steps are visible but not yet available', async ({ page }) => {
  const steps = page.getByRole('navigation', { name: 'Ablauf' });
  await expect(steps.locator('[aria-current="step"]')).toHaveText('Bild');
  await expect(steps.locator('[aria-disabled="true"]')).toHaveCount(4); // Bild + Einstellungen are available (part 5)
});

test.describe('phone screen', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('landscape photo fits a portrait phone screen, toolbar reachable', async ({ page }) => {
    const buffer = await createImage(page, { width: 1600, height: 900 });
    await pickFile(page, 'Foto auswählen', { name: 'quer.jpg', mimeType: 'image/jpeg', buffer });
    await expectReady(page);
    const box = await drawnImageBox(page);
    expect(box.width).toBe(box.canvasWidth);
    expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.02);
    await expect(page.getByRole('button', { name: 'Bild entfernen' })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Foto aufnehmen' })).toHaveCount(0); // only in empty state
  });
});
