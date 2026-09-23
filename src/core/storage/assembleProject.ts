import type { EffectiveOneLineSettings } from '../drawing';
import { ARTWORK_PROJECT_SCHEMA_VERSION, type AnimationSettings, type ArtworkProject, type OneLinePath, type OriginalImage } from '../models';
import type { RenderSettings } from '../rendering/renderSettings';
import { IDENTITY_EDIT, type ImageEdit } from '../imageEdit';
import { CURRENT_VERSIONS } from './projectRecord';
import { STORAGE_LIMITS } from './types';

export interface AssembleProjectParams {
  readonly id: string;
  readonly name: string;
  /** Kept from the first save; `now` for a new project. */
  readonly createdAt: string | null;
  readonly now: Date;
  readonly image: OriginalImage;
  /** Omitted = unedited. */
  readonly edit?: ImageEdit;
  readonly oneLine: EffectiveOneLineSettings;
  readonly path: OneLinePath;
  readonly render: RenderSettings;
  readonly animation: AnimationSettings;
}

/** Builds the project from the CURRENT session state; the only way projects are created. */
export function assembleProject(p: AssembleProjectParams): ArtworkProject {
  const now = p.now.toISOString();
  return {
    schemaVersion: ARTWORK_PROJECT_SCHEMA_VERSION,
    id: p.id,
    name: p.name.trim().slice(0, STORAGE_LIMITS.maxNameLength),
    createdAt: p.createdAt ?? now,
    updatedAt: now,
    image: p.image,
    edit: p.edit ?? IDENTITY_EDIT,
    oneLine: p.oneLine,
    render: p.render,
    animation: p.animation,
    path: p.path,
    versions: CURRENT_VERSIONS,
  };
}
