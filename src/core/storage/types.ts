import type { ArtworkProject, BinarySource, ProjectVersions, Size } from '../models';
import type { ProjectFileContents } from './projectFile';
import type { DrawingStyle, OneLineDetailLevel } from '../drawing';
import type { RenderColorMode } from '../rendering';
import { DEFAULT_IMPORT_OPTIONS } from '../imageImport/options';

export type StorageErrorCode =
  /** No persistent storage in this environment (e.g. IndexedDB blocked). */
  | 'unavailable'
  /** The browser/device refused to store more data. */
  | 'quota-exceeded'
  | 'not-found'
  /** Stored data is incomplete or inconsistent. */
  | 'damaged'
  /** Made by a newer (or no longer supported) app version. */
  | 'incompatible-version'
  /** The project cannot be stored (no drawing, too large, inconsistent). */
  | 'invalid-project'
  | 'write-failed'
  | 'read-failed';

export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? code, options);
    this.name = 'StorageError';
  }
}

export const storageErrorCode = (error: unknown): StorageErrorCode => (error instanceof StorageError ? error.code : 'read-failed');

/** Safety limits for stored projects (single definition). */
export const STORAGE_LIMITS = {
  maxNameLength: 80,
  maxPathPoints: 1_000_000,
  maxImageBytes: DEFAULT_IMPORT_OPTIONS.maxFileBytes,
  maxThumbnailBytes: 2 * 1024 * 1024,
  /** Gallery thumbnail long edge in px. */
  thumbnailEdge: 512,
} as const;

/** Small preview image of the artwork (rendered from the path, never a screenshot). */
export interface ProjectThumbnail {
  readonly data: BinarySource;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
}

export type ProjectSummaryStatus = 'ok' | 'damaged' | 'incompatible';

/** What the gallery needs; loading it never reads the path or the original image. */
export interface ProjectSummary {
  readonly id: string;
  readonly status: ProjectSummaryStatus;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly detailLevel: OneLineDetailLevel | null;
  /** Drawing style; null for unreadable projects. */
  readonly style: DrawingStyle | null;
  /** True when detail or smoothing deviate from the preset. */
  readonly custom: boolean;
  readonly colorMode: RenderColorMode | null;
  readonly imageSize: Size | null;
  readonly pointCount: number;
  readonly thumbnail: ProjectThumbnail | null;
  readonly favorite: boolean;
}

export interface LoadedProject {
  readonly project: ArtworkProject;
  readonly thumbnail: ProjectThumbnail | null;
  /** Algorithm parts whose version differs from the running app (informational; nothing is changed). */
  readonly outdated: readonly (keyof ProjectVersions)[];
}

/** Local persistence of projects (IndexedDB in the browser; later native storage). */
export interface ProjectRepository {
  /** Creates or replaces a project atomically (settings, path, original, thumbnail). */
  save(project: ArtworkProject, thumbnail: ProjectThumbnail | null): Promise<void>;
  load(id: string): Promise<LoadedProject>;
  list(): Promise<readonly ProjectSummary[]>;
  rename(id: string, name: string): Promise<void>;
  /** Marks or unmarks a favourite (does not change the project's "last changed" date). */
  setFavorite(id: string, favorite: boolean): Promise<void>;
  /**
   * Copies a project into a NEW, independent record `newId` (settings, path,
   * thumbnail); the original photo is shared by content hash, not copied.
   */
  duplicate(id: string, newId: string, name: string): Promise<void>;
  /** Removes the project and every piece of local data only it used. */
  remove(id: string): Promise<void>;
  /**
   * Stores a checked project file as a NEW project `id` (never replaces one):
   * new image id, name made unique ("… – Import"), created date kept, changed
   * date = now, not a favourite. A photo already stored (same content) is
   * shared, not stored twice. Returns the stored name.
   */
  importProject(file: ProjectFileContents, options: ProjectImportOptions): Promise<{ readonly id: string; readonly name: string }>;
}

export interface ProjectImportOptions {
  readonly id: string;
  readonly imageId: string;
  /** Wraps file bytes as storable binary data (a Blob in the browser). */
  readonly toBinary: (bytes: Uint8Array, mimeType: string) => BinarySource;
}

export const STORE_NAMES = ['projects', 'paths', 'images', 'thumbnails'] as const;
export type StoreName = (typeof STORE_NAMES)[number];

export type StorageOp =
  | { readonly type: 'put'; readonly store: StoreName; readonly key: string; readonly value: unknown }
  | { readonly type: 'delete'; readonly store: StoreName; readonly key: string };

/**
 * Minimal key-value port the repository is built on. `commit` must apply all
 * operations atomically (one IndexedDB transaction).
 */
export interface StorageBackend {
  get(store: StoreName, key: string): Promise<unknown>;
  entries(store: StoreName): Promise<readonly (readonly [string, unknown])[]>;
  commit(ops: readonly StorageOp[]): Promise<void>;
}
