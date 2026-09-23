import { expect, type Page } from '@playwright/test';
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input } from 'mediabunny';
import { createImage, pickFile, type Layout } from './helpers';

/** Counts worker starts (analysis / path generation) of the page. */
export async function trackWorkers(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __workers: string[] };
    w.__workers = [];
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        w.__workers.push(String(url));
      }
    } as typeof Worker;
  });
}

export const workers = (page: Page, name: string) =>
  page.evaluate((n) => (window as unknown as { __workers: string[] }).__workers.filter((u) => u.includes(n)).length, name);

export const settingsScreen = (page: Page) => page.getByTestId('settings-screen');
export const exportScreen = (page: Page) => page.getByTestId('export-screen');
export const imagePanel = (page: Page) => page.getByRole('group', { name: 'Bild' });
export const videoPanel = (page: Page) => page.getByRole('group', { name: 'Video' });

/** Import → analysis → drawing (optional detail level / colour) → settings screen ready. */
export async function createArtwork(page: Page, image: { width: number; height: number; layout?: Layout }, opts: { detail?: string; url?: string } = {}) {
  await page.goto(opts.url ?? '/');
  await pickFile(page, 'Bild auswählen', { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: await createImage(page, { layout: 'left-right', ...image }) });
  await expect(page.getByTestId('image-toolbar')).toHaveAttribute('data-analysis-status', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Weiter' }).click();
  if (opts.detail) await page.getByRole('radio', { name: opts.detail }).click();
  await expect(settingsScreen(page)).toHaveAttribute('data-path-status', 'ready', { timeout: 60_000 });
}

/** From the settings screen via the animation to the export screen. */
export async function goToExport(page: Page) {
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByTestId('animation-screen')).toBeVisible();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(exportScreen(page)).toBeVisible();
}

/** Runs an export via the UI and downloads the result. */
export async function exportAndDownload(page: Page, kind: 'Bild' | 'Video', timeout = 60_000) {
  await page.getByRole('button', { name: `${kind} exportieren` }).click();
  await expect(exportScreen(page)).toHaveAttribute('data-export-status', 'ready', { timeout });
  const ready = page.getByTestId('export-ready');
  const downloading = page.waitForEvent('download');
  await ready.getByRole('button', { name: 'Herunterladen' }).click();
  const download = await downloading;
  const path = await download.path();
  const { readFile } = await import('node:fs/promises');
  return { fileName: download.suggestedFilename(), buffer: await readFile(path), mimeType: (await ready.getAttribute('data-mime-type'))! };
}

/** Pixel size from the file header (PNG IHDR / JPEG SOFn). */
export function imageDimensions(buffer: Buffer): { format: 'png' | 'jpeg'; width: number; height: number } {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { format: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let i = 2;
    while (i < buffer.length) {
      if (buffer[i] !== 0xff) throw new Error('Bad JPEG marker');
      const marker = buffer[i + 1]!;
      const length = buffer.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: 'jpeg', height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
      }
      i += 2 + length;
    }
  }
  throw new Error('Unknown image format');
}

/** Demuxes a video file (no decoding): codec, size, duration, frame count. */
export async function probeVideo(buffer: Buffer) {
  const input = new Input({ source: new BufferSource(new Uint8Array(buffer)), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('No video track');
  let frames = 0;
  let lastTimestamp = 0;
  for await (const packet of new EncodedPacketSink(track).packets()) {
    frames++;
    lastTimestamp = Math.max(lastTimestamp, packet.timestamp);
  }
  return {
    mimeType: await input.getMimeType(),
    codec: track.codec,
    width: track.displayWidth,
    height: track.displayHeight,
    durationS: await input.computeDuration(),
    frames,
    lastTimestampS: lastTimestamp,
  };
}

/** Share of coloured pixels among the line pixels of an encoded image, decoded in the page. */
export async function colourfulness(page: Page, buffer: Buffer, mimeType: string) {
  return page.evaluate(
    async ({ base64, mimeType }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      let line = 0, coloured = 0;
      for (let i = 0; i < data.length; i += 4 * 7) {
        const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
        if (r + g + b > 600) continue;
        line++;
        if (Math.max(r, g, b) - Math.min(r, g, b) > 40) coloured++;
      }
      return { line: line / (data.length / 28), coloured: line ? coloured / line : 0 };
    },
    { base64: buffer.toString('base64'), mimeType },
  );
}
