import { expect, test, type Page } from '@playwright/test';
import { createArtwork, exportAndDownload, firstInkAround, probeVideo, settingsScreen, trackWorkers, videoPanel, workers } from './exportHelpers';
import { createImage, pickFile } from './helpers';

type Core = typeof import('../src/core');
type Animator = typeof import('../src/platform/browser/animation/artworkAnimator');
type Renderer = typeof import('../src/platform/browser/artworkRenderer');
type Decoder = typeof import('../src/platform/browser/bitmapDecoder');

test.beforeEach(async ({ page }) => trackWorkers(page));

const canvas = (page: Page) => page.getByTestId('animation-canvas');
const openPanel = async (page: Page) => {
  if (!(await page.getByTestId('playback-panel').isVisible())) await page.getByRole('button', { name: 'Wiedergabe' }).click();
};
/** Clicks the start picker at a normalized position of the image. */
async function pickStart(page: Page, x: number, y: number) {
  await openPanel(page);
  await page.getByRole('button', { name: 'Startpunkt setzen' }).click();
  const box = (await page.getByTestId('start-picker').boundingBox())!;
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  await expect(page.getByTestId('start-marker')).toBeVisible();
}
const startOf = async (page: Page) => (await canvas(page).getAttribute('data-start'))!.split(',').map(Number) as [number, number];

test('final frame equals the static artwork for every direction and start point; drawing begins at the start', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const core: Core = await import('/src/core/index.ts' as string);
    const { createArtworkAnimator }: Animator = await import('/src/platform/browser/animation/artworkAnimator.ts' as string);
    const { renderArtwork }: Renderer = await import('/src/platform/browser/artworkRenderer.ts' as string);
    const width = 400, height = 300;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set(i % width < width / 2 ? [220, 30, 30, 255] : [30, 30, 220, 255], i * 4);
    const image = { width, height, data };
    // A boustrophedon path (rows left→right→left…): its geometry makes positions easy to check.
    const coords: number[] = [];
    for (let row = 0; row < 12; row++) {
      const y = 15 + row * 24;
      const xs = [15, 385];
      if (row % 2) xs.reverse();
      for (let k = 0; k <= 20; k++) coords.push(xs[0]! + ((xs[1]! - xs[0]!) * k) / 20, y);
    }
    const path = { coords: new Float32Array(coords), bounds: { width, height }, meta: { generatorId: 'test', generatorVersion: '1', seed: 1 } };
    const before = path.coords.slice();
    const out: { name: string; maxDiff: number; startInk: [number, number] | null }[] = [];
    const grab = (ctx: OffscreenCanvasRenderingContext2D, w: number, h: number) => ctx.getImageData(0, 0, w, h).data;
    for (const [colorMode, lineOpacity] of [
      ['monochrome', 1],
      ['gradient', 1],
      ['sampled-color', 0.5],
    ] as const) {
      const settings = core.sanitizeRenderSettings({ colorMode, lineWidth: 2, lineOpacity }).value;
      const still = await renderArtwork({ path, settings, longEdge: 800, image });
      const ref = new OffscreenCanvas(still.size.width, still.size.height).getContext('2d')!;
      ref.drawImage(still.image, 0, 0);
      const b = grab(ref, still.size.width, still.size.height);
      for (const direction of ['forward', 'reverse'] as const) {
        for (const startPoint of [null, { x: 0.8, y: 0.45 }, { x: 0.05, y: 0.53 }]) {
          const animator = createArtworkAnimator({ path, settings, longEdge: 800, image, direction, startPoint });
          const { width: w, height: h } = animator.size;
          const target = new OffscreenCanvas(w, h).getContext('2d')! as unknown as CanvasRenderingContext2D;
          // Early frame: where is the ink? (centroid of pixels that differ from white/background)
          animator.renderFresh(target, 0.004);
          const early = grab(target as unknown as OffscreenCanvasRenderingContext2D, w, h);
          let sx = 0, sy = 0, n = 0;
          for (let i = 0; i < early.length; i += 4) {
            if (early[i]! + early[i + 1]! + early[i + 2]! < 600) {
              sx += (i / 4) % w;
              sy += Math.floor(i / 4 / w);
              n++;
            }
          }
          for (let f = 0; f <= 30; f++) animator.renderAt(target, f / 30);
          const a = grab(target as unknown as OffscreenCanvasRenderingContext2D, w, h);
          let max = 0;
          for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i]! - b[i]!));
          out.push({ name: `${colorMode}/${direction}/${startPoint ? `${startPoint.x},${startPoint.y}` : 'auto'}`, maxDiff: max, startInk: n ? [sx / n / w, sy / n / h] : null });
          animator.dispose();
        }
      }
    }
    return { out, unchanged: before.every((v, i) => v === path.coords[i]) };
  });
  expect(results.unchanged).toBe(true);
  for (const r of results.out) {
    expect(r.maxDiff, r.name).toBe(0);
    const [, direction, start] = r.name.split('/');
    const expected = start === 'auto' ? (direction === 'forward' ? [15 / 400, 15 / 300] : [15 / 400, 279 / 300]) : start!.split(',').map(Number);
    // The first ink lies at the chosen start (snapped onto the nearest row of the path).
    expect(r.startInk, r.name).not.toBeNull();
    expect(Math.abs(r.startInk![0] - expected[0]!), r.name).toBeLessThan(0.06);
    expect(Math.abs(r.startInk![1] - expected[1]!), r.name).toBeLessThan(0.06);
  }
});

test('duration, speed and direction: presets, own value, 2 s hold; nothing is recomputed', async ({ page }) => {
  test.setTimeout(120_000);
  await createArtwork(page, { width: 800, height: 600 });
  const paths = await workers(page, 'pathGeneration');
  await page.getByRole('button', { name: 'Weiter' }).click();
  const time = page.locator('.player__time');
  await expect(time).toHaveText('0:00 / 0:12'); // 10 s + 2 s hold

  // Own duration: 7.5 s
  await page.getByRole('radio', { name: 'Eigene' }).click();
  const own = page.getByRole('slider', { name: 'Eigene Dauer' });
  await own.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  await expect(own).toHaveAttribute('aria-valuetext', '7,5 s');
  await expect(page.getByText('7,5 s Zeichnen + 2 s fertiges Bild = 9,5 s')).toBeVisible();
  await expect(time).toHaveText('0:00 / 0:09');

  // Speed 2× → 3.75 s drawing; direction reverse.
  await openPanel(page);
  await page.getByRole('radio', { name: '2×' }).click();
  await expect(page.getByText('3,8 s (7,5 s bei 2×) Zeichnen + 2 s fertiges Bild = 5,8 s')).toBeVisible();
  await page.getByRole('radio', { name: 'Rückwärts' }).click();
  await expect(canvas(page)).toHaveAttribute('data-direction', 'reverse');

  // Plays to the end: drawing finished after 3.75 s, then 2 s hold.
  await page.getByRole('button', { name: 'Abspielen' }).click();
  await expect(canvas(page)).toHaveAttribute('data-phase', 'hold', { timeout: 10_000 });
  const holdStart = Date.now();
  await expect(canvas(page)).toHaveAttribute('data-status', 'finished', { timeout: 10_000 });
  expect(Date.now() - holdStart).toBeGreaterThan(1_500);
  expect(Number(await canvas(page).getAttribute('data-progress'))).toBe(1);

  // Presets still work directly.
  await page.getByRole('radio', { name: '5 s', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Eigene Dauer' })).toBeHidden();
  await page.getByRole('radio', { name: '1×' }).click();
  await expect(time).toHaveText(/\/ 0:07$/);

  expect(await workers(page, 'pathGeneration')).toBe(paths);
  expect(await workers(page, 'analysis')).toBe(1);
});

test('start point: set on the image, visible, used, reset — without recomputing the drawing', async ({ page }) => {
  test.setTimeout(120_000);
  await createArtwork(page, { width: 800, height: 600 });
  const paths = await workers(page, 'pathGeneration');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(canvas(page)).toHaveAttribute('data-start', 'auto');
  await expect(page.getByTestId('start-marker')).toHaveCount(0);

  await pickStart(page, 0.7, 0.4);
  const [x, y] = await startOf(page);
  // Snapped onto the line next to the tapped point.
  expect(Math.abs(x - 0.7)).toBeLessThan(0.05);
  expect(Math.abs(y - 0.4)).toBeLessThan(0.05);
  await expect(page.getByTestId('playback-panel')).toContainText(/Startpunkt|nächstgelegenen/);

  // The marker is UI only: the canvas shows no drawing at progress 0.
  expect(await canvas(page).evaluate((c: HTMLCanvasElement) => {
    const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < data.length; i += 4) if (data[i]! + data[i + 1]! + data[i + 2]! < 600) return false;
    return true;
  })).toBe(true);

  // Plays and finishes.
  await page.getByRole('radio', { name: '5 s', exact: true }).click();
  await page.getByRole('button', { name: 'Abspielen' }).click();
  await expect(canvas(page)).toHaveAttribute('data-status', 'finished', { timeout: 15_000 });

  // Reset → the path's own start.
  await page.getByRole('button', { name: 'Zurücksetzen' }).click();
  await expect(canvas(page)).toHaveAttribute('data-start', 'auto');
  await expect(page.getByTestId('start-marker')).toHaveCount(0);

  expect(await workers(page, 'pathGeneration')).toBe(paths);
  expect(await workers(page, 'analysis')).toBe(1);
});

test.describe('start point on a phone (touch)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('picked ON the artwork: a finger slide shows where the line starts, lifting the finger sets it', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await pickFile(page, 'Foto auswählen', { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: await createImage(page, { layout: 'left-right', width: 800, height: 600 }) });
    await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Weiter' }).click();
    await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
    const paths = await workers(page, 'pathGeneration');
    await page.getByRole('button', { name: 'Weiter' }).click();
    await openPanel(page);
    await page.getByRole('button', { name: 'Startpunkt setzen' }).click();
    const picker = page.getByTestId('start-picker');
    await picker.scrollIntoViewIfNeeded();

    // The picker shows the finished line over the faded photo (faded photo alone is never darker than ~55 % white).
    expect(await picker.locator('canvas').evaluate((c: HTMLCanvasElement) => {
      const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i]! + data[i + 1]! + data[i + 2]! < 240) ink++;
      return ink;
    })).toBeGreaterThan(100);

    // Real touch sequence: down, slide, up (a slide must not scroll the page or cancel the choice).
    const box = (await picker.boundingBox())!;
    const at = (x: number, y: number) => [{ x: box.x + box.width * x, y: box.y + box.height * y }];
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0.3, 0.6) });
    for (let k = 1; k <= 5; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(0.3 + 0.08 * k, 0.6 - 0.04 * k) });
    const preview = page.getByTestId('start-preview');
    await expect(preview).toBeVisible();
    await expect(picker).toBeVisible();
    await expect(page.getByTestId('start-marker')).toHaveCount(0);
    const p = (await preview.boundingBox())!;
    const shown = [(p.x + p.width / 2 - box.x) / box.width, (p.y + p.height / 2 - box.y) / box.height];
    expect(Math.abs(shown[0]! - 0.7)).toBeLessThan(0.05);
    expect(Math.abs(shown[1]! - 0.4)).toBeLessThan(0.05);

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(picker).toBeHidden();
    await expect(page.getByTestId('start-marker')).toBeVisible();
    // The start is exactly the previewed line point.
    const [x, y] = await startOf(page);
    expect(Math.abs(x - shown[0]!)).toBeLessThan(0.01);
    expect(Math.abs(y - shown[1]!)).toBeLessThan(0.01);

    // Choosing plays back the same line: nothing recomputed.
    expect(await workers(page, 'pathGeneration')).toBe(paths);
  });
});

test('start point with image edits: the transform matches the real pixels for crop, zoom, pan and every rotation', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const core: Core = await import('/src/core/index.ts' as string);
    const { bitmapDecoder, applyImageEdit }: Decoder = await import('/src/platform/browser/bitmapDecoder.ts' as string);
    // White photo with one black dot at a known place of the ORIGINAL.
    const W = 600, H = 400, dot = { x: 0.62, y: 0.35 };
    const c = new OffscreenCanvas(W, H);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(dot.x * W, dot.y * H, 6, 0, Math.PI * 2);
    ctx.fill();
    const blob = await c.convertToBlob({ type: 'image/png' });
    const imported = await core.importImage(new File([blob], 'dot.png', { type: 'image/png' }), { decoder: bitmapDecoder, createId: () => 'd' });
    const size = imported.original.metadata;
    const edits: [string, import('../src/core').ImageEdit][] = [
      ['none', core.IDENTITY_EDIT],
      ['crop', { rotation: 0, crop: { x: 0.4, y: 0.1, width: 0.5, height: 0.6 } }],
      ['zoom', core.withZoom(core.IDENTITY_EDIT, 2, size)],
      ['pan', core.withPan(core.withZoom(core.IDENTITY_EDIT, 2, size), { x: 0.6, y: 0.4 })],
      ['90', { rotation: 90, crop: core.FULL_CROP }],
      ['180', { rotation: 180, crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.7 } }],
      ['270', { rotation: 270, crop: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 } }],
    ];
    return Promise.all(
      edits.map(async ([name, edit]) => {
        const e = await applyImageEdit(imported.preview, edit, size);
        const { width, height, data } = e.pixels;
        let sx = 0, sy = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i]! < 100) {
            sx += (i / 4) % width;
            sy += Math.floor(i / 4 / width);
            n++;
          }
        }
        const expected = core.originalToEdited(dot, edit);
        return { name, found: [(sx / n + 0.5) / width, (sy / n + 0.5) / height], expected: [expected.x, expected.y] };
      }),
    );
  });
  for (const r of results) {
    expect(Math.abs(r.found[0]! - r.expected[0]!), r.name).toBeLessThan(0.01);
    expect(Math.abs(r.found[1]! - r.expected[1]!), r.name).toBeLessThan(0.01);
  }
});

test('start point after rotating and cropping: tapping the dot starts the drawing at the dot; a new edit drops it', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  // A grey photo with one dark square: the line is dense there, so the snapped start lies on it.
  const buffer = Buffer.from(
    await page.evaluate(async () => {
      const c = new OffscreenCanvas(900, 600);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#d8d8d8';
      ctx.fillRect(0, 0, 900, 600);
      ctx.fillStyle = '#101010';
      ctx.fillRect(900 * 0.7 - 30, 600 * 0.3 - 30, 60, 60);
      const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    }),
    'base64',
  );
  await pickFile(page, 'Bild auswählen', { name: 'q.png', mimeType: 'image/png', buffer });
  await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  // Rotate right and crop to 4:5.
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await page.getByRole('button', { name: 'Nach rechts drehen' }).click();
  await page.getByRole('radio', { name: '4:5' }).click();
  const edit = await page.getByTestId('image-editor').getAttribute('data-edit');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
  const paths = await workers(page, 'pathGeneration');
  await page.getByRole('button', { name: 'Weiter' }).click();

  // Where does the square appear in the edited image? (pure geometry, no screen sizes)
  const target = await page.evaluate(async (key) => {
    const core: Core = await import('/src/core/index.ts' as string);
    const [rotation, rest] = key!.split(':');
    const [x, y, width, height] = rest!.split(',').map(Number) as [number, number, number, number];
    return core.originalToEdited({ x: 0.7, y: 0.3 }, { rotation: Number(rotation) as 0 | 90 | 180 | 270, crop: { x, y, width, height } });
  }, edit);
  await pickStart(page, target.x, target.y);
  const [sx, sy] = await startOf(page);
  expect(Math.abs(sx - target.x)).toBeLessThan(0.05);
  expect(Math.abs(sy - target.y)).toBeLessThan(0.05);
  expect(await workers(page, 'pathGeneration')).toBe(paths);

  // A new edit changes the coordinates: the start point is not carried over blindly.
  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await page.getByRole('button', { name: 'Nach links drehen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(canvas(page)).toHaveAttribute('data-start', 'auto');
  await expect(page.getByTestId('start-marker')).toHaveCount(0);
});

test('video export and saved project keep duration, speed, direction and start point', async ({ page }) => {
  test.setTimeout(180_000);
  await createArtwork(page, { width: 800, height: 600 }, { detail: 'Minimal' });
  await page.getByRole('radio', { name: 'Geometrisch' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
  const paths = await workers(page, 'pathGeneration');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('radio', { name: 'Eigene' }).click();
  const own = page.getByRole('slider', { name: 'Eigene Dauer' });
  await own.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft'); // 8 s
  await expect(own).toHaveAttribute('aria-valuetext', '8 s');
  await openPanel(page);
  await page.getByRole('radio', { name: '2×' }).click();
  await page.getByRole('radio', { name: 'Rückwärts' }).click();
  await pickStart(page, 0.3, 0.6);
  const start = await canvas(page).getAttribute('data-start');

  // Video: 8 s ÷ 2 = 4 s drawing + 2 s hold.
  await page.getByRole('button', { name: 'Weiter' }).click();
  await videoPanel(page).getByRole('radio', { name: '1080p' }).click();
  const video = await exportAndDownload(page, 'Video', 120_000);
  const probe = await probeVideo(video.buffer);
  expect(probe.durationS).toBeCloseTo(6, 0);
  expect(probe.frames).toBe(6 * 30 + 1);
  // The video really starts at the chosen point: the first line pixels lie there (and only there).
  const [x0, y0] = start!.split(',').map(Number) as [number, number];
  const expectStartsAt = async (buffer: Buffer) => {
    const ink = await firstInkAround(page, buffer, { x: x0, y: y0 });
    expect(ink).not.toBeNull();
    expect(ink!.nearest).toBeLessThan(0.02);
    expect(ink!.farthest).toBeLessThan(0.35);
  };
  await expectStartsAt(video.buffer);

  // Save, restart, reopen: the same choices, no computation.
  await page.getByTestId('save-project').click();
  await expect(page.getByTestId('save-project')).toHaveAttribute('data-save-status', 'saved');
  await page.reload();
  await page.getByRole('button', { name: 'Meine Werke' }).click();
  await page.getByTestId('gallery-item').first().getByRole('button', { name: /öffnen/ }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(canvas(page)).toHaveAttribute('data-start', start!);
  await expect(canvas(page)).toHaveAttribute('data-direction', 'reverse');
  await expect(page.getByRole('slider', { name: 'Eigene Dauer' })).toHaveAttribute('aria-valuetext', '8 s');
  await expect(page.getByTestId('save-project')).toHaveText('Gespeichert');
  expect(await workers(page, 'pathGeneration')).toBe(0);
  expect(await workers(page, 'analysis')).toBe(0);
  expect(paths).toBeGreaterThan(0);

  // Export again from the gallery: the stored start point is used again.
  await page.getByRole('button', { name: 'Meine Werke' }).click();
  await page.getByTestId('gallery-item').first().getByRole('button', { name: 'Erneut exportieren' }).click();
  await expect(page.getByTestId('export-screen')).toBeVisible();
  await videoPanel(page).getByRole('radio', { name: '1080p' }).click();
  await expectStartsAt((await exportAndDownload(page, 'Video', 120_000)).buffer);
  expect(await workers(page, 'pathGeneration')).toBe(0);
});

