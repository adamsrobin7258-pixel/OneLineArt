import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_EXPORT_SETTINGS,
  DEFAULT_VIDEO_EXPORT_SETTINGS,
  EXPORT_LIMITS,
  ExportError,
  IMAGE_FORMAT_INFO,
  exportFileName,
  imageExportSize,
  sanitizeFileBaseName,
  sanitizeImageExportSettings,
  sanitizeVideoExportSettings,
  settingsForOpaqueOutput,
  videoFrameSize,
  DEFAULT_RENDER_SETTINGS,
} from '../../../src/core';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ExportError ? e.code : 'other';
  }
  return 'none';
};

describe('export settings', () => {
  it('defaults: PNG (lossless) at 4096 px; video 1080p, 30 fps, 10 s', () => {
    expect(sanitizeImageExportSettings()).toEqual(DEFAULT_IMAGE_EXPORT_SETTINGS);
    expect(DEFAULT_IMAGE_EXPORT_SETTINGS.format).toBe('png');
    expect(IMAGE_FORMAT_INFO.png).toMatchObject({ mimeType: 'image/png', extension: 'png', lossless: true });
    expect(IMAGE_FORMAT_INFO.jpeg).toMatchObject({ mimeType: 'image/jpeg', extension: 'jpg' });
    expect(sanitizeVideoExportSettings()).toEqual({ resolution: '1080p', fps: 30, durationMs: 10_000 });
    expect(DEFAULT_VIDEO_EXPORT_SETTINGS.fps).toBe(30);
  });

  it('accepts every offered value', () => {
    for (const format of ['png', 'jpeg'] as const) for (const resolution of ['original', '2048', '4096'] as const) {
      expect(sanitizeImageExportSettings({ format, resolution })).toMatchObject({ format, resolution });
    }
    for (const durationMs of [5000, 10000, 15000, 30000]) for (const fps of [30, 60] as const) {
      expect(sanitizeVideoExportSettings({ durationMs, fps, resolution: '4096' })).toEqual({ durationMs, fps, resolution: '4096' });
    }
  });

  it('rejects unknown and non-finite values instead of replacing them silently', () => {
    expect(code(() => sanitizeImageExportSettings({ format: 'gif' as never }))).toBe('invalid-settings');
    expect(code(() => sanitizeImageExportSettings({ resolution: '8000' as never }))).toBe('invalid-settings');
    expect(code(() => sanitizeImageExportSettings({ jpegQuality: Number.NaN }))).toBe('invalid-settings');
    expect(code(() => sanitizeVideoExportSettings({ fps: 25 as never }))).toBe('invalid-settings');
    expect(code(() => sanitizeVideoExportSettings({ fps: Number.NaN as never }))).toBe('invalid-settings');
    expect(code(() => sanitizeVideoExportSettings({ durationMs: 7000 }))).toBe('invalid-settings');
    expect(code(() => sanitizeVideoExportSettings({ durationMs: Number.POSITIVE_INFINITY }))).toBe('invalid-settings');
  });

  it('clamps JPEG quality into its range', () => {
    expect(sanitizeImageExportSettings({ jpegQuality: 5 }).jpegQuality).toBe(EXPORT_LIMITS.jpegQuality.max);
    expect(sanitizeImageExportSettings({ jpegQuality: 0 }).jpegQuality).toBe(EXPORT_LIMITS.jpegQuality.min);
  });

  it('formats without alpha get white instead of a transparent background', () => {
    expect(settingsForOpaqueOutput({ ...DEFAULT_RENDER_SETTINGS, background: 'transparent' }).background).toBe('white');
    const original = { ...DEFAULT_RENDER_SETTINGS, background: 'original' as const };
    expect(settingsForOpaqueOutput(original)).toBe(original);
  });
});

describe('image export size (long edge, exact aspect ratio)', () => {
  it('6000×4000 → 4096×2731 and 3000×4000 → 3072×4096', () => {
    expect(imageExportSize({ width: 2048, height: 1365 }, { width: 6000, height: 4000 }, '4096').size).toEqual({ width: 4096, height: 2730 });
    // The artwork's own aspect ratio (processing copy) decides; with the exact 3:2 working size:
    expect(imageExportSize({ width: 6000, height: 4000 }, { width: 6000, height: 4000 }, '4096').size).toEqual({ width: 4096, height: 2731 });
    expect(imageExportSize({ width: 1536, height: 2048 }, { width: 3000, height: 4000 }, '4096').size).toEqual({ width: 3072, height: 4096 });
  });

  it('2048, 4096 and original keep the aspect ratio of portrait, landscape and square', () => {
    for (const bounds of [
      { width: 1536, height: 2048 },
      { width: 2048, height: 1152 },
      { width: 2048, height: 2048 },
      { width: 777, height: 555 },
    ]) {
      for (const resolution of ['2048', '4096', 'original'] as const) {
        const { size, limited } = imageExportSize(bounds, { width: bounds.width * 2, height: bounds.height * 2 }, resolution);
        const ratio = bounds.width / bounds.height;
        expect(Math.abs(size.width / size.height - ratio)).toBeLessThanOrEqual(ratio / Math.min(size.width, size.height) + 1e-9);
        expect(Math.max(size.width, size.height)).toBe(resolution === 'original' ? Math.max(bounds.width, bounds.height) * 2 : Number(resolution));
        expect(limited).toBe(false);
      }
    }
  });

  it('original size uses the photo, also below the preview size', () => {
    expect(imageExportSize({ width: 700, height: 700 }, { width: 700, height: 700 }, 'original').size).toEqual({ width: 700, height: 700 });
  });

  it('very large originals are reduced to the safety limits and reported', () => {
    const r = imageExportSize({ width: 2048, height: 1536 }, { width: 12000, height: 9000 }, 'original');
    expect(r.limited).toBe(true);
    expect(r.requestedLongEdge).toBe(12000);
    expect(r.size.width * r.size.height).toBeLessThanOrEqual(EXPORT_LIMITS.imagePixels);
    expect(Math.max(r.size.width, r.size.height)).toBeLessThanOrEqual(EXPORT_LIMITS.imageEdge);
    const panorama = imageExportSize({ width: 2048, height: 512 }, { width: 20000, height: 5000 }, 'original');
    expect(panorama.size.width).toBe(EXPORT_LIMITS.imageEdge);
  });

  it('rejects invalid sizes', () => {
    expect(code(() => imageExportSize({ width: 0, height: 10 }, { width: 10, height: 10 }, '2048'))).toBe('invalid-settings');
    expect(code(() => imageExportSize({ width: 10, height: 10 }, { width: Number.NaN, height: 10 }, 'original'))).toBe('invalid-settings');
  });
});

describe('video frame size', () => {
  it('1080p fits into 1920×1080 (upright: 1080×1920)', () => {
    expect(videoFrameSize({ width: 1920, height: 1080 }, '1080p').size).toEqual({ width: 1920, height: 1080 });
    expect(videoFrameSize({ width: 1080, height: 1920 }, '1080p').size).toEqual({ width: 1080, height: 1920 });
    expect(videoFrameSize({ width: 2048, height: 1536 }, '1080p').size).toEqual({ width: 1440, height: 1080 });
    expect(videoFrameSize({ width: 2048, height: 2048 }, '1080p').size).toEqual({ width: 1080, height: 1080 });
  });

  it('always even dimensions, aspect ratio within renderer rounding', () => {
    for (const bounds of [
      { width: 900, height: 700 },
      { width: 777, height: 555 },
      { width: 1001, height: 1999 },
      { width: 2048, height: 1365 },
    ]) {
      for (const resolution of ['1080p', '2048', '4096'] as const) {
        const { size } = videoFrameSize(bounds, resolution);
        expect(size.width % 2).toBe(0);
        expect(size.height % 2).toBe(0);
        const ratio = bounds.width / bounds.height;
        expect(Math.abs(size.width / size.height - ratio)).toBeLessThanOrEqual(ratio / Math.min(size.width, size.height) + 1e-9);
        if (resolution !== '1080p') expect(Math.max(size.width, size.height)).toBeGreaterThan(Number(resolution) - 64);
        expect(size.width * size.height).toBeLessThanOrEqual(EXPORT_LIMITS.videoPixels);
      }
    }
  });
});

describe('file names', () => {
  const date = new Date(2026, 8, 23, 14, 30, 59);
  it('OneLine_<date>_<time>.<ext> by default', () => {
    expect(exportFileName({ date, extension: 'png' })).toBe('OneLine_2026-09-23_1430.png');
    expect(exportFileName({ date, extension: '.MP4' })).toBe('OneLine_2026-09-23_1430.mp4');
    expect(exportFileName({ date: new Date(2026, 0, 5, 7, 4), extension: 'jpg' })).toBe('OneLine_2026-01-05_0704.jpg');
  });

  it('uses a cleaned project name', () => {
    expect(exportFileName({ projectName: 'Oma am Meer', date, extension: 'webm' })).toBe('Oma_am_Meer_2026-09-23_1430.webm');
    expect(sanitizeFileBaseName('  Größe: <1/2> ?  ')).toBe('Größe_12');
    expect(sanitizeFileBaseName('../../etc')).toBe('etc');
    expect(sanitizeFileBaseName('***')).toBe('OneLine');
    expect(sanitizeFileBaseName(null)).toBe('OneLine');
    expect(sanitizeFileBaseName('x'.repeat(100))).toHaveLength(40);
  });

  it('rejects invalid dates and extensions', () => {
    expect(() => exportFileName({ date: new Date(Number.NaN), extension: 'png' })).toThrow(RangeError);
    expect(() => exportFileName({ date, extension: 'p/ng' })).toThrow(RangeError);
  });
});
