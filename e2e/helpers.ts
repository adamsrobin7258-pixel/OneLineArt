import { expect, type Page } from '@playwright/test';
import { exifApp1 } from '../tests/fixtures/imageBytes';

export type Layout = 'left-right' | 'solid';

export interface ImageSpec {
  width: number;
  height: number;
  type?: 'image/jpeg' | 'image/png';
  /** left-right: left half red, right half blue. */
  layout?: Layout;
  color?: string;
  /** Inserts an EXIF APP1 with this orientation (JPEG only). */
  exifOrientation?: number;
}

/** Encodes a real image file in the browser (canvas → JPEG/PNG). */
export async function createImage(page: Page, spec: ImageSpec): Promise<Buffer> {
  const exif = spec.exifOrientation ? exifApp1(spec.exifOrientation) : null;
  const base64 = await page.evaluate(
    async ({ width, height, type, layout, color, exif }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      if (layout === 'left-right') {
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, width / 2, height);
        ctx.fillStyle = '#0000ff';
        ctx.fillRect(width / 2, 0, width / 2, height);
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, width, height);
      }
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), type, 0.9));
      let bytes = new Uint8Array(await blob.arrayBuffer());
      if (exif) bytes = new Uint8Array([0xff, 0xd8, ...exif, ...bytes.subarray(2)]); // after SOI
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    },
    { width: spec.width, height: spec.height, type: spec.type ?? 'image/jpeg', layout: spec.layout ?? 'solid', color: spec.color ?? '#808080', exif },
  );
  return Buffer.from(base64, 'base64');
}

/** Opens the system picker via the given button and selects a file (or cancels with null). */
export async function pickFile(page: Page, buttonName: string, file: { name: string; mimeType: string; buffer: Buffer } | null) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  await (await chooser).setFiles(file ? [file] : []);
}

export const status = (page: Page) => page.getByTestId('import-screen');

export async function expectReady(page: Page) {
  await expect(status(page)).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
}

/** Bounding box of drawn (non-transparent) pixels in the viewer canvas, in canvas pixels. */
export async function drawnImageBox(page: Page) {
  const canvas = page.getByTestId('image-viewer').locator('canvas');
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3]))
    .toBe(255);
  return canvas.evaluate((c: HTMLCanvasElement) => {
    const { data, width, height } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3]! > 128) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, canvasWidth: width, canvasHeight: height };
  });
}

/** RGB at a relative position inside the drawn image. */
export async function colorAt(page: Page, rx: number, ry: number) {
  const box = await drawnImageBox(page);
  return page.getByTestId('image-viewer').locator('canvas').evaluate(
    (c: HTMLCanvasElement, p) => Array.from(c.getContext('2d')!.getImageData(p.x, p.y, 1, 1).data.slice(0, 3)),
    { x: Math.round(box.x + box.width * rx), y: Math.round(box.y + box.height * ry) },
  );
}

export const isRed = ([r, g, b]: number[]) => r! > 200 && g! < 60 && b! < 60;
export const isBlue = ([r, g, b]: number[]) => b! > 200 && r! < 60 && g! < 60;
