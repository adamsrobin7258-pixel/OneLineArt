import { sanitizeAnimationSettings } from '../animation/animationSettings';
import { DETAIL_LEVELS, DRAWING_STYLES, type EffectiveOneLineSettings } from '../drawing';
import { sanitizeImageEdit, type ImageEdit } from '../imageEdit';
import { ANALYSIS_ALGORITHM_VERSION } from '../imageAnalysis/parameters';
import { ONE_LINE_ENGINE_VERSION } from '../engine/oneLine/parameters';
import {
  ARTWORK_PROJECT_SCHEMA_VERSION,
  type AnimationSettings,
  type ArtworkProject,
  type BinarySource,
  type ImageMetadata,
  type OneLinePath,
  type OneLinePathMeta,
  type ProjectVersions,
  type Size,
} from '../models';
import { RENDERER_VERSION, sanitizeRenderSettings, type RenderSettings } from '../rendering/renderSettings';
import { STORAGE_LIMITS, StorageError, type ProjectThumbnail } from './types';

/** Versions of the running app; stored with every project. */
export const CURRENT_VERSIONS: ProjectVersions = {
  project: ARTWORK_PROJECT_SCHEMA_VERSION,
  analysis: ANALYSIS_ALGORITHM_VERSION,
  engine: ONE_LINE_ENGINE_VERSION,
  renderer: RENDERER_VERSION,
};

/** Project settings and metadata (small; no binary data). Store "projects". */
export interface ProjectRecord {
  readonly formatVersion: number;
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly image: { readonly id: string; readonly fileName: string; readonly contentHash: string; readonly metadata: ImageMetadata };
  /** Added in phase 12.2; absent in older records (= unedited). */
  readonly edit: ImageEdit;
  readonly oneLine: EffectiveOneLineSettings;
  readonly render: RenderSettings;
  readonly animation: AnimationSettings;
  readonly path: { readonly bounds: Size; readonly meta: OneLinePathMeta; readonly pointCount: number };
  readonly versions: ProjectVersions;
  readonly thumbnail: { readonly width: number; readonly height: number; readonly mimeType: string } | null;
}

/** Store "paths", key = project id. */
export interface PathRecord {
  readonly coords: Float32Array;
}

/** Store "images", key = content hash (one copy per distinct photo). */
export interface ImageRecord {
  readonly contentHash: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly data: BinarySource;
}

/** Store "thumbnails", key = project id. */
export interface ThumbnailRecord {
  readonly data: BinarySource;
}

/**
 * Upgrades a record of format version n to n+1. Only lossless, well-defined
 * steps belong here; anything else is reported as incompatible instead of
 * silently changing a path or an artwork.
 */
export const PROJECT_MIGRATIONS: Readonly<Record<number, (record: Record<string, unknown>) => Record<string, unknown>>> = {};

const damaged = (what: string) => new StorageError('damaged', `Stored project: ${what}`);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown, max = 1000): v is string => typeof v === 'string' && v.length <= max;
const isPositiveInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const isSize = (v: unknown): v is Size => isObject(v) && isPositiveInt(v.width) && isPositiveInt(v.height);
const isDate = (v: unknown): v is string => isText(v, 40) && !Number.isNaN(Date.parse(v));
const isOptionalNumber = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v));

function check<T>(ok: boolean, value: unknown, what: string): T {
  if (!ok) throw damaged(what);
  return value as T;
}

/** Checks a project before it is stored. */
export function validateProject(project: ArtworkProject): void {
  const invalid = (what: string) => new StorageError('invalid-project', what);
  const { path, image } = project;
  if (!path) throw invalid('Project has no drawing');
  const points = path.coords.length / 2;
  if (!Number.isInteger(points) || points < 2) throw invalid('Path needs at least 2 points');
  if (points > STORAGE_LIMITS.maxPathPoints) throw invalid(`Path has ${points} points (limit ${STORAGE_LIMITS.maxPathPoints})`);
  for (let i = 0; i < path.coords.length; i++) if (!Number.isFinite(path.coords[i])) throw invalid('Path contains non-finite coordinates');
  if (path.meta.sourceImageId !== undefined && path.meta.sourceImageId !== image.id) throw invalid('Path belongs to another image');
  if (image.source.size > STORAGE_LIMITS.maxImageBytes) throw invalid('Original image too large to store');
  if (!project.id || !isDate(project.createdAt) || !isDate(project.updatedAt)) throw invalid('Missing id or dates');
  if (project.name.length > STORAGE_LIMITS.maxNameLength) throw invalid('Name too long');
}

export function toProjectRecord(project: ArtworkProject, thumbnail: ProjectThumbnail | null): ProjectRecord {
  const { image, path } = project;
  return {
    formatVersion: ARTWORK_PROJECT_SCHEMA_VERSION,
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    image: { id: image.id, fileName: image.fileName, contentHash: image.contentHash, metadata: image.metadata },
    edit: project.edit,
    oneLine: project.oneLine,
    render: project.render,
    animation: project.animation,
    path: { bounds: path.bounds, meta: path.meta, pointCount: path.coords.length / 2 },
    versions: project.versions,
    thumbnail: thumbnail ? { width: thumbnail.width, height: thumbnail.height, mimeType: thumbnail.mimeType } : null,
  };
}

/** Reads a stored record: migrates older formats, rejects newer/unknown ones and damaged data. */
export function parseProjectRecord(raw: unknown): ProjectRecord {
  if (!isObject(raw)) throw damaged('not an object');
  let record: Record<string, unknown> = raw;
  const version = record.formatVersion;
  if (!Number.isInteger(version) || (version as number) < 1) throw damaged('missing format version');
  if ((version as number) > ARTWORK_PROJECT_SCHEMA_VERSION) {
    throw new StorageError('incompatible-version', `Project format ${String(version)} is newer than ${ARTWORK_PROJECT_SCHEMA_VERSION}`);
  }
  for (let v = version as number; v < ARTWORK_PROJECT_SCHEMA_VERSION; v++) {
    const migrate = PROJECT_MIGRATIONS[v];
    if (!migrate) throw new StorageError('incompatible-version', `No migration from project format ${v}`);
    record = { ...migrate(record), formatVersion: v + 1 };
  }

  const image = check<Record<string, unknown>>(isObject(record.image), record.image, 'image');
  const metadata = check<ImageMetadata>(isObject(image.metadata) && isPositiveInt(image.metadata.width) && isPositiveInt(image.metadata.height), image.metadata, 'image metadata');
  const stored = check<EffectiveOneLineSettings>(
    isObject(record.oneLine) &&
      isText(record.oneLine.key, 100_000) &&
      isText(record.oneLine.engineVersion) &&
      isObject(record.oneLine.drawing) &&
      (DETAIL_LEVELS as readonly unknown[]).includes(record.oneLine.drawing.detailLevel) &&
      (record.oneLine.drawing.style === undefined || (DRAWING_STYLES as readonly unknown[]).includes(record.oneLine.drawing.style)) &&
      isOptionalNumber(record.oneLine.drawing.detail) &&
      isOptionalNumber(record.oneLine.drawing.smoothing) &&
      isObject(record.oneLine.settings) &&
      isObject(record.oneLine.parameters),
    record.oneLine,
    'drawing settings',
  );
  // Projects saved before styles existed are Organic presets (same key, same path).
  const legacy: Partial<EffectiveOneLineSettings['drawing']> = stored.drawing;
  const oneLine: EffectiveOneLineSettings = { ...stored, drawing: { ...stored.drawing, style: legacy.style ?? 'organic', detail: legacy.detail ?? null, smoothing: legacy.smoothing ?? null } };
  const path = check<ProjectRecord['path']>(
    isObject(record.path) && isSize(record.path.bounds) && isObject(record.path.meta) && isPositiveInt(record.path.pointCount) && (record.path.pointCount as number) >= 2,
    record.path,
    'path info',
  );
  const versions = check<ProjectVersions>(
    isObject(record.versions) && Number.isInteger(record.versions.project) && isText(record.versions.analysis) && isText(record.versions.engine) && isText(record.versions.renderer),
    record.versions,
    'versions',
  );
  const thumbnail = record.thumbnail === null ? null : check<ProjectRecord['thumbnail']>(isObject(record.thumbnail) && isPositiveInt(record.thumbnail.width) && isPositiveInt(record.thumbnail.height) && isText(record.thumbnail.mimeType), record.thumbnail, 'thumbnail info');

  return {
    formatVersion: ARTWORK_PROJECT_SCHEMA_VERSION,
    id: check<string>(isText(record.id, 200) && record.id.length > 0, record.id, 'id'),
    name: check<string>(isText(record.name, STORAGE_LIMITS.maxNameLength), record.name, 'name'),
    createdAt: check<string>(isDate(record.createdAt), record.createdAt, 'createdAt'),
    updatedAt: check<string>(isDate(record.updatedAt), record.updatedAt, 'updatedAt'),
    image: {
      id: check<string>(isText(image.id, 200) && image.id.length > 0, image.id, 'image id'),
      fileName: check<string>(isText(image.fileName), image.fileName, 'file name'),
      contentHash: check<string>(isText(image.contentHash, 200) && image.contentHash.length > 0, image.contentHash, 'content hash'),
      metadata,
    },
    // Older records have no edit: the unedited image, exactly as before.
    edit: strictSettings('image edit', () => sanitizeImageEdit(record.edit)),
    oneLine,
    render: strictSettings('render settings', () => sanitizeRenderSettings(record.render as Partial<RenderSettings>)),
    animation: strictSettings('animation settings', () => sanitizeAnimationSettings(record.animation as Partial<AnimationSettings>)),
    path,
    versions,
    thumbnail,
  };
}

/** Stored settings must already be valid: nothing is adjusted silently on load. */
function strictSettings<T>(what: string, sanitize: () => { value: T; issues: readonly unknown[] }): T {
  let result: { value: T; issues: readonly unknown[] };
  try {
    result = sanitize();
  } catch {
    throw damaged(what);
  }
  if (result.issues.length > 0) throw damaged(what);
  return result.value;
}

/** Rebuilds the path from its stored coordinates (a fresh copy; the record is never shared). */
export function parsePathRecord(raw: unknown, record: ProjectRecord): OneLinePath {
  if (!isObject(raw) || !(raw.coords instanceof Float32Array)) throw damaged('path data missing');
  const coords = raw.coords;
  if (coords.length !== record.path.pointCount * 2) throw damaged('path length');
  for (let i = 0; i < coords.length; i++) if (!Number.isFinite(coords[i])) throw damaged('path coordinates');
  if (record.path.meta.sourceImageId !== undefined && record.path.meta.sourceImageId !== record.image.id) throw damaged('path belongs to another image');
  return { coords: new Float32Array(coords), bounds: { ...record.path.bounds }, meta: { ...record.path.meta } };
}

export function parseImageRecord(raw: unknown, record: ProjectRecord): ImageRecord {
  if (!isObject(raw) || !isObject(raw.data) || typeof (raw.data as { slice?: unknown }).slice !== 'function') throw damaged('original image missing');
  if (raw.contentHash !== record.image.contentHash) throw damaged('original image does not match');
  const data = raw.data as unknown as BinarySource;
  if (data.size !== record.image.metadata.fileSizeBytes) throw damaged('original image size');
  return raw as unknown as ImageRecord;
}

export function outdatedParts(versions: ProjectVersions): (keyof ProjectVersions)[] {
  return (Object.keys(CURRENT_VERSIONS) as (keyof ProjectVersions)[]).filter((k) => versions[k] !== CURRENT_VERSIONS[k]);
}
