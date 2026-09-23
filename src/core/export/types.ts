import type { OneLinePath, Size } from '../models';
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
