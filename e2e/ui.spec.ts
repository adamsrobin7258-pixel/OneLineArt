import { expect, test, type Page } from '@playwright/test';
import { createArtwork, goToExport, settingsScreen, trackWorkers, workers } from './exportHelpers';

type Animator = typeof import('../src/platform/browser/animation/artworkAnimator');
type Core = typeof import('../src/core');

test.beforeEach(async ({ page }) => trackWorkers(page));

const steps = (page: Page) => page.getByRole('navigation', { name: 'Ablauf' });
const canvas = (page: Page) => page.getByTestId('animation-canvas');

async function noHorizontalOverflow(page: Page) {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll, 'horizontal overflow').toBeLessThanOrEqual(client);
}

test('navigation shows the real flow; done steps can be revisited', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const items = steps(page).locator('.steps__list > li');
  await expect(items).toHaveText(['Bild', 'Zeichnung', 'Vorschau', 'Export']);
  await expect(steps(page)).not.toContainText('Generieren');
  await expect(steps(page)).not.toContainText('Ergebnis');

  await createArtwork(page, { width: 900, height: 600 });
  await expect(steps(page).locator('[aria-current="step"]')).toHaveText('Zeichnung');
  await expect(items.nth(0)).toHaveClass(/is-done/);
  await expect(items.nth(2)).not.toHaveAttribute('aria-disabled', 'true');
  await goToExport(page);
  await expect(steps(page).locator('[aria-current="step"]')).toHaveText('Export');
  // Jump back to an earlier step via the step list.
  await steps(page).getByRole('button', { name: 'Zeichnung' }).click();
  await expect(settingsScreen(page)).toBeVisible();
  await steps(page).getByRole('button', { name: 'Vorschau' }).click();
  await expect(page.getByTestId('animation-screen')).toBeVisible();
  expect(await workers(page, 'pathGeneration')).toBe(1);
});

for (const [name, width, height] of [
  ['desktop 1920', 1920, 1080],
  ['desktop 1440', 1440, 900],
  ['desktop 1280', 1280, 800],
  ['tablet 768', 768, 1024],
  ['tablet 1024', 1024, 768],
  ['phone 390', 390, 844],
  ['phone 393', 393, 873],
  ['phone 430', 430, 932],
] as const) {
  test(`responsive ${name}×${height}: no overflow, artwork visible, actions reachable`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await noHorizontalOverflow(page);
    await expect(page.getByRole('button', { name: 'Bild auswählen' })).toBeInViewport();
    await createArtwork(page, { width: 900, height: 600 });

    // Drawing step: artwork large, all options and navigation visible.
    await noHorizontalOverflow(page);
    const art = await page.getByTestId('image-viewer').boundingBox();
    expect(art!.width).toBeGreaterThan(width * 0.6);
    expect(art!.height).toBeGreaterThan(height * 0.25);
    for (const label of ['Minimal', 'Balanced', 'Detail', 'Einfarbig', 'Verlauf', 'Foto']) await expect(page.getByRole('radio', { name: label, exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Weiter' })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Meine Werke' })).toBeInViewport();

    // Preview: canvas, player and navigation fit.
    await page.getByRole('button', { name: 'Weiter' }).click();
    await noHorizontalOverflow(page);
    const box = (await canvas(page).boundingBox())!;
    expect(box.width).toBeGreaterThan(Math.min(width, 900) * 0.5);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
    for (const label of ['Abspielen', 'Von vorn', 'Weiter']) await expect(page.getByRole('button', { name: label })).toBeInViewport();

    // Export: every option reachable (panel may scroll on phones).
    await page.getByRole('button', { name: 'Weiter' }).click();
    await noHorizontalOverflow(page);
    for (const label of ['Bild exportieren', 'Video exportieren']) {
      const button = page.getByRole('button', { name: label });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
    }

    // Gallery with one saved work.
    await page.getByTestId('save-project').click();
    await expect(page.getByTestId('save-project')).toHaveText('Gespeichert');
    await page.getByRole('button', { name: 'Meine Werke' }).click();
    await expect(page.getByTestId('gallery-item')).toHaveCount(1);
    await noHorizontalOverflow(page);
    const card = (await page.getByTestId('gallery-item').boundingBox())!;
    expect(card.x + card.width).toBeLessThanOrEqual(width);
    expect(card.width).toBeGreaterThan(140);

    // Touch targets on phones: every visible button is at least 40 px high.
    if (width < 500) {
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('button')]
          .filter((b) => b.offsetParent !== null && !b.closest('.animation__overlay'))
          .map((b) => [b.getAttribute('aria-label') ?? b.textContent, Math.round(b.getBoundingClientRect().height)] as const)
          .filter(([, h]) => h < 40),
      );
      expect(small).toEqual([]);
    }
  });
}

test('final hold: the finished artwork stays ~2 s, pause works during it, the end is complete', async ({ page }) => {
  test.setTimeout(120_000);
  await createArtwork(page, { width: 800, height: 600 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('radio', { name: '5 s', exact: true }).click();
  await expect(page.getByRole('radiogroup', { name: 'Dauer' }).locator('..')).toContainText('5 s Zeichnen + 2 s fertiges Bild = 7 s');
  await page.getByRole('button', { name: 'Abspielen' }).click();
  // Drawing complete, still playing: the hold.
  await expect(canvas(page)).toHaveAttribute('data-phase', 'hold', { timeout: 10_000 });
  await expect(canvas(page)).toHaveAttribute('data-progress', '1.0000');
  await expect(canvas(page)).toHaveAttribute('data-status', 'playing');
  const holdStart = Date.now();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(canvas(page)).toHaveAttribute('data-status', 'paused');
  await page.waitForTimeout(800);
  await expect(canvas(page)).toHaveAttribute('data-status', 'paused');
  const pausedAt = Number(await canvas(page).getAttribute('data-position-ms'));
  expect(pausedAt).toBeGreaterThanOrEqual(5000);
  expect(pausedAt).toBeLessThan(7000);
  await page.getByRole('button', { name: 'Abspielen' }).click();
  await expect(canvas(page)).toHaveAttribute('data-status', 'finished', { timeout: 5000 });
  expect(Date.now() - holdStart).toBeGreaterThan(900);
  await expect(page.locator('.player__time')).toHaveText('0:07 / 0:07');
  await expect(canvas(page)).toHaveAttribute('data-progress', '1.0000');
});

test('hold frames are identical to the static artwork and are not redrawn', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const core: Core = await import('/src/core/index.ts' as string);
    const { createArtworkAnimator }: Animator = await import('/src/platform/browser/animation/artworkAnimator.ts' as string);
    const { renderArtworkSurface } = await import('/src/platform/browser/artworkRenderer.ts' as string);
    const width = 300, height = 200;
    const coords: number[] = [];
    for (let i = 0; i < 400; i++) coords.push(10 + ((i * 37) % 280), 10 + ((i * 0.45) % 180));
    const path = { coords: new Float32Array(coords), bounds: { width, height }, meta: { generatorId: 't', generatorVersion: '1', seed: 1 } };
    const out = [];
    for (const lineOpacity of [1, 0.6]) {
      const settings = core.sanitizeRenderSettings({ lineWidth: 2, lineOpacity }).value;
      const image = { width, height, data: new Uint8ClampedArray(width * height * 4) };
      const animator = createArtworkAnimator({ path, settings, longEdge: 600, image });
      const ctx = new OffscreenCanvas(animator.size.width, animator.size.height).getContext('2d')! as unknown as CanvasRenderingContext2D;
      for (let k = 0; k <= 20; k++) animator.renderAt(ctx, k / 20);
      const first = ctx.getImageData(0, 0, animator.size.width, animator.size.height).data.slice();
      const holds = [1, 2, 3].map(() => animator.renderAt(ctx, 1).renderMs);
      const again = ctx.getImageData(0, 0, animator.size.width, animator.size.height).data;
      const still = renderArtworkSurface({ path, settings, longEdge: 600, image });
      const ref = still.surface.ctx.getImageData(0, 0, animator.size.width, animator.size.height).data;
      let maxDiff = 0;
      for (let i = 0; i < ref.length; i++) maxDiff = Math.max(maxDiff, Math.abs(ref[i]! - again[i]!));
      out.push({ lineOpacity, same: first.every((v, i) => v === again[i]), maxDiff, holdMs: Math.max(...holds) });
    }
    return out;
  });
  for (const o of r) {
    expect(o.same, `opacity ${o.lineOpacity}`).toBe(true);
    // Opaque: pixel-identical; semi-transparent line goes through a layer (±1 rounding at edges).
    expect(o.maxDiff, `opacity ${o.lineOpacity}`).toBeLessThanOrEqual(o.lineOpacity === 1 ? 0 : 2);
  }
});

test('keyboard only: choose level, continue, play, export options, gallery dialog', async ({ page }) => {
  test.setTimeout(120_000);
  await createArtwork(page, { width: 800, height: 600 });
  // Radio groups: arrow keys change the selection.
  await page.getByRole('radio', { name: 'Balanced' }).focus();
  await expect(page.getByRole('radio', { name: 'Balanced' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Detail' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: 'Detail' })).toBeFocused();
  // Keyboard focus is clearly visible.
  const outline = await page.getByRole('radio', { name: 'Detail' }).evaluate((el) => [getComputedStyle(el).outlineStyle, getComputedStyle(el).outlineWidth]);
  expect(outline).toEqual(['solid', '2px']);
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
  await expect(page.getByText('Mehr feine Strukturen und Details')).toBeVisible();

  // Tab reaches "Weiter"; Enter activates it.
  for (let i = 0; i < 12 && !(await page.getByRole('button', { name: 'Weiter' }).evaluate((b) => b === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Weiter' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('animation-screen')).toBeVisible();
  await page.getByRole('button', { name: 'Abspielen' }).focus();
  await page.keyboard.press('Space');
  await expect(canvas(page)).toHaveAttribute('data-status', 'playing');
  await page.keyboard.press('Space');
  await expect(canvas(page)).toHaveAttribute('data-status', 'paused');

  // Save + gallery + delete dialog: Escape cancels, focus stays inside the dialog.
  await page.getByTestId('save-project').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('save-project')).toHaveText('Gespeichert');
  await page.getByRole('button', { name: 'Meine Werke' }).focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('gallery-item').getByRole('button', { name: 'Löschen' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Werk wirklich löschen?' });
  await expect(dialog).toBeVisible();
  // The page behind is inert: focus is only ever inside the dialog (or briefly in the browser UI).
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement === document.body || !!document.activeElement?.closest('dialog'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('gallery-item')).toHaveCount(1);
});

test('readable contrast, no technical terms, no debug data in the normal flow', async ({ page }) => {
  test.setTimeout(120_000);
  await createArtwork(page, { width: 800, height: 600 });
  const contrast = await page.evaluate(() => {
    const rgb = (c: string) => c.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
    const lum = (c: string) => {
      const [r, g, b] = rgb(c).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const ratio = (a: string, b: string) => {
      const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (l1! + 0.05) / (l2! + 0.05);
    };
    const bg = getComputedStyle(document.body).backgroundColor;
    return ['.option__caption', '.option__label', '.segmented__option:not(.is-selected)', '.steps__link'].map((s) => ratio(getComputedStyle(document.querySelector(s)!).color, bg));
  });
  for (const c of contrast) expect(c).toBeGreaterThanOrEqual(4.5);

  const technical = /engine|seed|importance|demand|parameter|point budget|webcodecs|mediabunny|worker|sampling/i;
  await expect(page.locator('body')).not.toContainText(technical);
  await goToExport(page);
  await expect(page.locator('body')).not.toContainText(technical);
  await expect(page.getByTestId('animation-metrics')).toHaveCount(0);
  await expect(page.getByTestId('render-metrics')).toHaveCount(0);
});

test('reduced motion is respected', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const duration = await page.evaluate(() => {
    const el = document.createElement('span');
    el.className = 'spinner';
    document.body.append(el);
    return parseFloat(getComputedStyle(el).animationDuration);
  });
  expect(duration).toBeLessThan(0.01);
});
