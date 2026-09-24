import type { OneLinePath, Size } from '../models';
import type { ExportFile } from './exportState';
import type { RenderSettings } from '../rendering';

/**
 * Rendering settings for a given output: formats without alpha (JPEG, video)
 * get a white instead of a transparent background, so the result looks like
 * the artwork on screen instead of turning black.
 */
export function settingsForOpaqueOutput(settings: RenderSettings): RenderSettings {
  return settings.background === 'transparent' ? { ...settings, background: 'white' } : settings;
}

/** Everything an export needs from a project; the path is used as is, never recomputed. */
export interface ExportSource<TImage, TBackground> {
  readonly path: OneLinePath;
  readonly render: RenderSettings;
  /** Working image (colour sampling). */
  readonly image: TImage;
  /** Photo for background 'original'. */
  readonly backgroundImage: TBackground | null;
  /** Upright size of the original photo ("Originalgröße"). */
  readonly originalSize: Size;
  readonly projectName?: string | null | undefined;
}

/** Result of keeping a file on the device. */
export interface ExportSaveResult {
  /** User-facing place where the file is now (e.g. "Bilder/One Line Art"); null if the platform decides (browser download). */
  readonly location: string | null;
}

/**
 * What the platform does with a finished export (browser: download + Web
 * Share; Android: gallery + system share sheet). The export itself is always
 * produced by the same exporters; only this last step differs.
 */
export interface ExportFileActions<TData> {
  /** 'download': the browser's download; 'gallery': the device's photo/video collection. */
  readonly saveKind: 'download' | 'gallery';
  save(file: ExportFile<TData>): Promise<ExportSaveResult>;
  canShare(file: ExportFile<TData>): boolean;
  /** Resolves false if the user closed the share sheet without sharing (where the platform reports it). */
  share(file: ExportFile<TData>): Promise<boolean>;
  /**
   * Where available (Android app): the system "save as" dialog, the user picks place and name.
   * Resolves false when the dialog was closed without saving (not an error).
   */
  saveAs?(file: ExportFile<TData>): Promise<boolean>;
}
