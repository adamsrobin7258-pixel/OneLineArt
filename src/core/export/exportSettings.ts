import { ANIMATION_LIMITS, DURATION_PRESETS_MS, FINAL_HOLD_MS } from '../animation/animationSettings';
import { RENDER_LIMITS } from '../rendering/renderSettings';
import { ExportError } from './errors';

/**
 * Safety limits for everything that is exported or stored (single definition).
 * Sized for phones: a 4-byte RGBA buffer of `imagePixels` is ~160 MB.
 */
export const EXPORT_LIMITS = {
  /** Longest image edge (same guard as the renderer). */
  imageEdge: RENDER_LIMITS.renderEdge.max,
  /** Largest image area; "original size" is reduced to fit. */
  imagePixels: 40_000_000,
  /** Longest video edge. */
  videoEdge: 4096,
  /** Largest video frame area (4096 × 4096). */
  videoPixels: 4096 * 4096,
  /** Longest video (frames incl. the final one): longest drawing + final hold at 60 fps. */
  videoFrames: ((ANIMATION_LIMITS.durationMs.max + FINAL_HOLD_MS) / 1000) * 60 + 1,
  jpegQuality: { min: 0.5, max: 1 },
} as const;

export const IMAGE_EXPORT_FORMATS = ['png', 'jpeg'] as const;
export type ImageExportFormat = (typeof IMAGE_EXPORT_FORMATS)[number];

export const IMAGE_FORMAT_INFO: Readonly<Record<ImageExportFormat, { readonly mimeType: string; readonly extension: string; readonly lossless: boolean }>> = {
  png: { mimeType: 'image/png', extension: 'png', lossless: true },
  jpeg: { mimeType: 'image/jpeg', extension: 'jpg', lossless: false },
};

/** Image resolution = long edge ('original' = long edge of the original photo). */
export const IMAGE_RESOLUTIONS = ['original', '2048', '4096'] as const;
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];

/** Video resolution: '1080p' fits the frame into 1920×1080 (1080×1920 upright); the others are the long edge. */
export const VIDEO_RESOLUTIONS = ['1080p', '2048', '4096'] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

export const VIDEO_FPS = [30, 60] as const;
export type VideoFps = (typeof VIDEO_FPS)[number];
/** Frame rates offered in the normal UI. 60 fps stays available to the API. */
export const UI_VIDEO_FPS: readonly VideoFps[] = [30];

export interface ImageExportSettings {
  readonly format: ImageExportFormat;
  readonly resolution: ImageResolution;
  /** JPEG only. */
  readonly jpegQuality: number;
}

export interface VideoExportSettings {
  readonly resolution: VideoResolution;
  readonly fps: VideoFps;
  /** Drawing time of the line (a preset); the video adds FINAL_HOLD_MS with the finished artwork. */
  readonly durationMs: number;
}

export const DEFAULT_IMAGE_EXPORT_SETTINGS: ImageExportSettings = { format: 'png', resolution: '4096', jpegQuality: 0.92 };
export const DEFAULT_VIDEO_EXPORT_SETTINGS: VideoExportSettings = { resolution: '1080p', fps: 30, durationMs: 10_000 };

function oneOf<T extends string | number>(name: string, value: unknown, allowed: readonly T[]): T {
  if ((allowed as readonly unknown[]).includes(value)) return value as T;
  throw new ExportError('invalid-settings', `${name} "${String(value)}" is not supported`);
}

function finiteIn(name: string, value: unknown, range: { readonly min: number; readonly max: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ExportError('invalid-settings', `${name} must be a finite number`);
  return Math.min(range.max, Math.max(range.min, value));
}

/** Validates image export settings; unknown values are errors (never silently replaced). */
export function sanitizeImageExportSettings(input: Partial<ImageExportSettings> = {}): ImageExportSettings {
  const s = { ...DEFAULT_IMAGE_EXPORT_SETTINGS, ...input };
  return {
    format: oneOf('format', s.format, IMAGE_EXPORT_FORMATS),
    resolution: oneOf('resolution', s.resolution, IMAGE_RESOLUTIONS),
    jpegQuality: finiteIn('jpegQuality', s.jpegQuality, EXPORT_LIMITS.jpegQuality),
  };
}

/** Validates video export settings; the duration must be one of the animation presets. */
export function sanitizeVideoExportSettings(input: Partial<VideoExportSettings> = {}): VideoExportSettings {
  const s = { ...DEFAULT_VIDEO_EXPORT_SETTINGS, ...input };
  return {
    resolution: oneOf('resolution', s.resolution, VIDEO_RESOLUTIONS),
    fps: oneOf('fps', s.fps, VIDEO_FPS),
    durationMs: oneOf('durationMs', s.durationMs, DURATION_PRESETS_MS),
  };
}
