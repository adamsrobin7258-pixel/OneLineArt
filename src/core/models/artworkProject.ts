import type { AnimationSettings } from './animationSettings';
import type { OneLinePath } from './oneLinePath';
import type { EffectiveOneLineSettings } from '../drawing';
import type { OriginalImage } from './originalImage';
import type { RenderSettings } from '../rendering';

export const ARTWORK_PROJECT_SCHEMA_VERSION = 1;

/** Everything needed to reopen, re-render or re-animate a piece of work. */
export interface ArtworkProject {
  readonly schemaVersion: typeof ARTWORK_PROJECT_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly image: OriginalImage;
  /** Detail level, seed, effective engine parameters and engine version: enough to reproduce the path. */
  readonly oneLine: EffectiveOneLineSettings;
  /** How the line is rendered (colour mode, background, width, opacity). */
  readonly render: RenderSettings;
  readonly animation: AnimationSettings;
  /** Null until a path was generated. */
  readonly path: OneLinePath | null;
}
