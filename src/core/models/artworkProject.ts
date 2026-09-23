import type { AnimationSettings } from './animationSettings';
import type { OneLinePath } from './oneLinePath';
import type { EffectiveOneLineSettings } from '../drawing';
import type { OriginalImage } from './originalImage';
import type { RenderSettings } from '../rendering';
import type { ImageEdit } from '../imageEdit';

/** Version of the stored project format ("projectVersion"). */
export const ARTWORK_PROJECT_SCHEMA_VERSION = 1;

/** Algorithm versions a project was made with; old projects stay identifiable. */
export interface ProjectVersions {
  readonly project: number;
  readonly analysis: string;
  readonly engine: string;
  readonly renderer: string;
}

/**
 * Everything needed to reopen, re-render, re-animate and export a piece of
 * work. The single source for preview, animation, export and gallery.
 */
export interface ArtworkProject {
  readonly schemaVersion: typeof ARTWORK_PROJECT_SCHEMA_VERSION;
  readonly id: string;
  /** Optional user-given name ('' = unnamed; the gallery shows the date). */
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly image: OriginalImage;
  /** Non-destructive edit (rotation + crop) of the original; identity for older projects. */
  readonly edit: ImageEdit;
  /** Detail level, seed, effective engine parameters and engine version: enough to reproduce the path. */
  readonly oneLine: EffectiveOneLineSettings;
  /** How the line is rendered (colour mode, background, width, opacity). */
  readonly render: RenderSettings;
  readonly animation: AnimationSettings;
  /** The finished drawing (stored as is; never recomputed on load). */
  readonly path: OneLinePath;
  readonly versions: ProjectVersions;
}
