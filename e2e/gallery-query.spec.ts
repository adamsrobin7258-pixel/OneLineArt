import { expect, test, type Page } from '@playwright/test';
import { colourfulness, createArtwork, exportAndDownload, exportScreen, imagePanel, settingsScreen, trackWorkers, videoPanel, workers } from './exportHelpers';
import { createImage, pickFile } from './helpers';

test.beforeEach(async ({ page }) => trackWorkers(page));

const gallery = (page: Page) => page.getByTestId('gallery-screen');
const items = (page: Page) => page.getByTestId('gallery-item');
const titles = (page: Page) => page.locator('[data-testid=gallery-item] .card__title');
const card = (page: Page, name: string) => items(page).filter({ has: page.locator('.card__title', { hasText: new RegExp(`^${name}$`) }) });
const search = (page: Page) => page.getByRole('searchbox', { name: 'Werke durchsuchen' });
const sortBy = (page: Page, label: 'Geändert' | 'Erstellt' | 'A–Z') => page.getByRole('radiogroup', { name: 'Sortierung' }).getByRole('radio', { name: label }).click();
const show = (page: Page, label: 'Alle' | 'Favoriten') => page.getByRole('radiogroup', { name: 'Anzeigen' }).getByRole('radio', { name: label }).click();

async function openGallery(page: Page) {
  await page.getByRole('button', { name: 'Meine Werke' }).click();
  await expect(gallery(page)).toBeVisible();
}

async function saveCurrent(page: Page) {
  await page.getByTestId('save-project').click();
  await expect(page.getByTestId('save-project')).toHaveAttribute('data-save-status', 'saved');
}

interface Seed {
  readonly name: string;
  /** Day in January 2026 the copy was created / last changed. */
  readonly created: number;
  readonly updated: number;
  readonly favorite?: boolean;
}

/**
 * Real works for the gallery: copies (settings, path, thumbnail) of the one work
 * saved in the app, with controlled creation / change dates. The saved original
 * is removed, so only the seeded works remain.
 */
async function seed(page: Page, works: readonly Seed[]) {
  await page.evaluate(async (works) => {
    const core = await import('/src/core/index.ts' as string);
    const { createIndexedDbBackend } = await import('/src/platform/browser/storage/indexedDbBackend.ts' as string);
    const backend = createIndexedDbBackend();
    let clock = new Date();
    const repo = core.createProjectRepository(backend, { now: () => clock });
    const [original] = await repo.list();
    for (const [k, work] of works.entries()) {
      const id = `seed-${k}`;
      clock = new Date(Date.UTC(2026, 0, work.created, 12));
      await repo.duplicate(original.id, id, work.name);
      clock = new Date(Date.UTC(2026, 0, work.updated, 12));
      await repo.rename(id, work.name);
      if (work.favorite) await repo.setFavorite(id, true);
    }
    await repo.remove(original.id);
  }, works);
}

const FIVE: readonly Seed[] = [
  { name: 'Oma am Meer', created: 1, updated: 20, favorite: true },
  { name: 'zebra', created: 2, updated: 10 },
  { name: 'Äpfel im Korb', created: 3, updated: 30 },
  { name: 'Bild 10', created: 4, updated: 5, favorite: true },
  { name: 'bild 2', created: 5, updated: 15 },
];

test('search (any case), order, favourites filter and their combination; order and filter are remembered, the search is not', async ({ page }) => {
  test.setTimeout(120_000);
  await createArtwork(page, { width: 600, height: 400 }, { detail: 'Minimal' });
  await saveCurrent(page);
  await seed(page, FIVE);
  await openGallery(page);
  await expect(items(page)).toHaveCount(5);
  await expect(page.getByTestId('gallery-count')).toHaveText('5 Werke auf diesem Gerät');

  // Default: last changed first — strictly, favourites are not pulled up.
  await expect(titles(page)).toHaveText(['Äpfel im Korb', 'Oma am Meer', 'bild 2', 'zebra', 'Bild 10']);
  await sortBy(page, 'Erstellt');
  await expect(titles(page)).toHaveText(['bild 2', 'Bild 10', 'Äpfel im Korb', 'zebra', 'Oma am Meer']);
  // The card shows the date the list is ordered by.
  await expect(card(page, 'Oma am Meer').locator('.card__detail')).toContainText('01.01.2026');
  await sortBy(page, 'A–Z');
  await expect(titles(page)).toHaveText(['Äpfel im Korb', 'bild 2', 'Bild 10', 'Oma am Meer', 'zebra']);
  await sortBy(page, 'Geändert');
  await expect(card(page, 'Oma am Meer').locator('.card__detail')).toContainText('20.01.2026');

  // Search: part of the name, any case, filters while typing.
  await search(page).fill('OMA');
  await expect(titles(page)).toHaveText(['Oma am Meer']);
  await expect(page.getByTestId('gallery-count')).toHaveText('1 von 5 Werken');
  await search(page).fill('bILd');
  await expect(titles(page)).toHaveText(['bild 2', 'Bild 10']);
  await search(page).fill('äPFEL');
  await expect(titles(page)).toHaveText(['Äpfel im Korb']);

  // Favourites filter, and the combination of all three.
  await search(page).fill('');
  await show(page, 'Favoriten');
  await expect(titles(page)).toHaveText(['Oma am Meer', 'Bild 10']);
  await search(page).fill('bild');
  await expect(titles(page)).toHaveText(['Bild 10']);
  await sortBy(page, 'A–Z');
  await search(page).fill('m');
  await expect(titles(page)).toHaveText(['Oma am Meer']);
  await show(page, 'Alle');
  await expect(titles(page)).toHaveText(['Äpfel im Korb', 'Oma am Meer']);

  // Nothing found: a clear message and a way back to all works.
  await search(page).fill('gibt es nicht');
  await expect(items(page)).toHaveCount(0);
  await expect(page.getByTestId('gallery-no-results')).toContainText('Keine passenden Werke');
  await page.getByRole('button', { name: 'Alle Werke anzeigen' }).click();
  await expect(search(page)).toHaveValue('');
  await expect(items(page)).toHaveCount(5);

  // Remembered: order and favourites filter; the search starts empty.
  await show(page, 'Favoriten');
  await search(page).fill('oma');
  await page.reload();
  await openGallery(page);
  await expect(page.getByRole('radiogroup', { name: 'Sortierung' }).getByRole('radio', { name: 'A–Z' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radiogroup', { name: 'Anzeigen' }).getByRole('radio', { name: 'Favoriten' })).toHaveAttribute('aria-checked', 'true');
  await expect(search(page)).toHaveValue('');
  await expect(titles(page)).toHaveText(['Bild 10', 'Oma am Meer']);

  // Nothing about a project changed by searching, sorting or filtering.
  const stored = await page.evaluate(async () => {
    const core = await import('/src/core/index.ts' as string);
    const { createIndexedDbBackend } = await import('/src/platform/browser/storage/indexedDbBackend.ts' as string);
    return (await core.createProjectRepository(createIndexedDbBackend()).list()).map((s: { name: string; favorite: boolean; updatedAt: string }) => [s.name, s.favorite, s.updatedAt.slice(0, 10)]);
  });
  expect(stored).toEqual(
    expect.arrayContaining([
      ['Oma am Meer', true, '2026-01-20'],
      ['zebra', false, '2026-01-10'],
      ['Äpfel im Korb', false, '2026-01-30'],
      ['Bild 10', true, '2026-01-05'],
      ['bild 2', false, '2026-01-15'],
    ]),
  );
  expect(await workers(page, 'pathGeneration')).toBe(0);
});

test('every project action still works in a searched / filtered list', async ({ page }) => {
  test.setTimeout(120_000);
  await createArtwork(page, { width: 600, height: 400 }, { detail: 'Minimal' });
  await saveCurrent(page);
  await seed(page, FIVE);
  await openGallery(page);
  await show(page, 'Alle');
  await search(page).fill('zebra');
  await expect(titles(page)).toHaveText(['zebra']);

  // Duplicate: the copy matches the search too.
  await card(page, 'zebra').getByRole('button', { name: 'Duplizieren' }).click();
  await expect(titles(page)).toHaveText(['zebra – Kopie', 'zebra']);
  // Rename out of the search: it leaves the list.
  await card(page, 'zebra – Kopie').getByRole('button', { name: 'Umbenennen' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Streifen');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(titles(page)).toHaveText(['zebra']);
  // Favourite with the favourites filter: appears there.
  await card(page, 'zebra').getByRole('button', { name: /^Favorit/ }).click();
  await expect(card(page, 'zebra')).toHaveAttribute('data-favorite', 'true');
  await show(page, 'Favoriten');
  await expect(titles(page)).toHaveText(['zebra']);
  // Unmark it there: it leaves the filtered list.
  await card(page, 'zebra').getByRole('button', { name: /^Favorit/ }).click();
  await expect(page.getByTestId('gallery-no-results')).toBeVisible();
  await show(page, 'Alle');
  // Delete (with confirmation) from a searched list.
  await search(page).fill('streifen');
  await card(page, 'Streifen').getByRole('button', { name: 'Löschen' }).click();
  await page.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(page.getByTestId('gallery-no-results')).toBeVisible();
  await search(page).fill('');
  await expect(items(page)).toHaveCount(5);
  // Open from a search result: the work opens without any computation.
  await search(page).fill('äpfel');
  const before = await workers(page, 'pathGeneration');
  await card(page, 'Äpfel im Korb').getByRole('button', { name: /öffnen/ }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 20_000 });
  expect(await workers(page, 'pathGeneration')).toBe(before);
  // Saving the open work still updates it (and it stays findable).
  await page.getByRole('radio', { name: 'Verlauf' }).click();
  await saveCurrent(page);
  await openGallery(page);
  await search(page).fill('äpfel');
  await expect(titles(page)).toHaveText(['Äpfel im Korb']);
});

test('many works: the gallery loads, searches and sorts 150 works quickly', async ({ page }) => {
  test.setTimeout(180_000);
  await createArtwork(page, { width: 600, height: 400 }, { detail: 'Minimal' });
  await saveCurrent(page);
  const works: Seed[] = Array.from({ length: 150 }, (_, k) => ({ name: `Werk ${k + 1} ${k % 10 === 0 ? 'Strand' : 'Stadt'}`, created: 1 + (k % 28), updated: 1 + ((k * 11) % 28), favorite: k % 25 === 0 }));
  await seed(page, works);

  let started = Date.now();
  await openGallery(page);
  await expect(items(page)).toHaveCount(150);
  const loadMs = Date.now() - started;

  started = Date.now();
  await search(page).fill('strand');
  await expect(items(page)).toHaveCount(15);
  const searchMs = Date.now() - started;
  await expect(page.getByTestId('gallery-count')).toHaveText('15 von 150 Werken');

  started = Date.now();
  await sortBy(page, 'A–Z');
  await expect(titles(page).first()).toHaveText('Werk 1 Strand');
  await expect(titles(page).nth(1)).toHaveText('Werk 11 Strand');
  await show(page, 'Favoriten');
  await expect(items(page)).toHaveCount(3);
  const sortMs = Date.now() - started;
  console.log(`gallery with 150 works: load ${loadMs} ms, search ${searchMs} ms, sort + filter ${sortMs} ms`);
  expect(loadMs).toBeLessThan(10_000);
  expect(searchMs).toBeLessThan(2_000);
  expect(sortMs).toBeLessThan(2_000);

  // Scrolling to the end of the full list works (cards far below are laid out on demand).
  await show(page, 'Alle');
  await search(page).fill('');
  await items(page).last().scrollIntoViewIfNeeded();
  await expect(items(page).last()).toBeInViewport();
});

test.describe('phone (touch)', () => {
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });

  test('search, order and filter fit a 360 px screen and work by touch', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await pickFile(page, 'Foto auswählen', { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: await createImage(page, { layout: 'left-right', width: 600, height: 400 }) });
    await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Weiter' }).tap();
    await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
    await page.getByTestId('save-project').tap();
    await expect(page.getByTestId('save-project')).toHaveAttribute('data-save-status', 'saved');
    await seed(page, FIVE);
    await page.getByRole('button', { name: 'Meine Werke' }).tap();
    await expect(items(page)).toHaveCount(5);

    // Everything inside the screen, nothing covered.
    const fits = await page.evaluate(() => {
      const W = document.documentElement.clientWidth;
      return [...document.querySelectorAll('[data-testid=gallery-tools] input, [data-testid=gallery-tools] [role=radio]')].every((e) => {
        const r = e.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return r.left >= 0 && r.right <= W && !!hit && (hit === e || e.contains(hit));
      });
    });
    expect(fits).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.getByRole('radiogroup', { name: 'Sortierung' }).getByRole('radio', { name: 'A–Z' }).tap();
    await expect(titles(page).first()).toHaveText('Äpfel im Korb');
    await page.getByRole('radiogroup', { name: 'Anzeigen' }).getByRole('radio', { name: 'Favoriten' }).tap();
    await expect(titles(page)).toHaveText(['Bild 10', 'Oma am Meer']);
    await search(page).tap();
    await page.keyboard.type('OMA');
    await expect(titles(page)).toHaveText(['Oma am Meer']);
  });
});

test('13.5 export: safe file names from the project name, current settings, no new path; again after reopening', async ({ page }) => {
  test.setTimeout(240_000);
  await createArtwork(page, { width: 800, height: 600 }, { detail: 'Minimal' });
  await page.getByRole('radio', { name: 'Orthogonal' }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
  await saveCurrent(page);
  // A name with characters no file system accepts.
  await openGallery(page);
  await items(page).first().getByRole('button', { name: 'Umbenennen' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('  Oma: am/Meer? <2026>  ');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(titles(page)).toHaveText(['Oma: am/Meer? <2026>']);
  const paths = await workers(page, 'pathGeneration');
  const analyses = await workers(page, 'analysis');

  // Reopen and export: the stored name, made safe, plus date and time.
  await items(page).first().getByRole('button', { name: /öffnen/ }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-style', 'orthogonal');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(exportScreen(page)).toBeVisible();
  await imagePanel(page).getByRole('radio', { name: '2048 px', exact: true }).click();
  const image = await exportAndDownload(page, 'Bild');
  expect(image.fileName).toMatch(/^Oma am Meer 2026 \d{4}-\d{2}-\d{2} \d{4}\.png$/);
  await expect(page.getByTestId('export-ready')).toHaveAttribute('data-file-name', image.fileName);
  const monochrome = await colourfulness(page, image.buffer, image.mimeType);
  expect(monochrome.coloured).toBeLessThan(0.05);

  // The current (unsaved) choice is what gets exported, not the stored one.
  await videoPanel(page).getByRole('radio', { name: 'Verlauf' }).click();
  const coloured = await colourfulness(page, (await exportAndDownload(page, 'Bild')).buffer, 'image/png');
  expect(coloured.coloured).toBeGreaterThan(0.3);
  const video = await exportAndDownload(page, 'Video', 120_000);
  expect(video.fileName).toMatch(/^Oma am Meer 2026 \d{4}-\d{2}-\d{2} \d{4}\.(mp4|webm)$/);

  // Export never computes a path.
  expect(await workers(page, 'pathGeneration')).toBe(paths);
  expect(await workers(page, 'analysis')).toBe(analyses);
});
