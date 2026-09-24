import { isCustomDrawing } from '../drawing';
import type { ArtworkProject } from '../models';
import { importedName } from './projectFile';
import {
  outdatedParts,
  parseImageRecord,
  parsePathRecord,
  parseProjectRecord,
  toProjectRecord,
  validateProject,
  type ImageRecord,
  type PathRecord,
  type ProjectRecord,
  type ThumbnailRecord,
} from './projectRecord';
import {
  STORAGE_LIMITS,
  StorageError,
  type LoadedProject,
  type ProjectRepository,
  type ProjectSummary,
  type ProjectThumbnail,
  type StorageBackend,
  type StorageOp,
} from './types';

export interface ProjectRepositoryOptions {
  /** Clock for "last changed" on rename (injected for tests). */
  readonly now?: () => Date;
}

/**
 * Project persistence on top of a key-value backend. Layout:
 *  - projects   id → settings, metadata, versions (small; read for the gallery)
 *  - paths      id → path coordinates (Float32Array)
 *  - images     content hash → original file (one copy per distinct photo)
 *  - thumbnails id → gallery thumbnail
 * Rendered artworks and videos are never stored; they are re-created on demand.
 */
export function createProjectRepository(backend: StorageBackend, options: ProjectRepositoryOptions = {}): ProjectRepository {
  const now = options.now ?? (() => new Date());

  const readRecord = async (id: string): Promise<ProjectRecord> => {
    const raw = await backend.get('projects', id);
    if (raw === undefined) throw new StorageError('not-found', `Project ${id} not found`);
    return parseProjectRecord(raw);
  };

  /** Hashes still used by any project other than `exceptId` (damaged records count as users if readable). */
  const hashesInUse = async (exceptId: string): Promise<Set<string>> => {
    const used = new Set<string>();
    for (const [key, raw] of await backend.entries('projects')) {
      if (key === exceptId) continue;
      const hash = (raw as { image?: { contentHash?: unknown } } | null)?.image?.contentHash;
      if (typeof hash === 'string') used.add(hash);
    }
    return used;
  };

  return {
    async save(project: ArtworkProject, thumbnail: ProjectThumbnail | null) {
      validateProject(project);
      if (thumbnail && thumbnail.data.size > STORAGE_LIMITS.maxThumbnailBytes) throw new StorageError('invalid-project', 'Thumbnail too large');
      // The favourite marker belongs to the gallery: saving the work again keeps it.
      const stored = (await backend.get('projects', project.id)) as { favorite?: unknown } | undefined;
      const record = toProjectRecord(project, thumbnail, stored?.favorite === true);
      const ops: StorageOp[] = [
        { type: 'put', store: 'projects', key: project.id, value: record },
        { type: 'put', store: 'paths', key: project.id, value: { coords: new Float32Array(project.path.coords) } satisfies PathRecord },
        thumbnail
          ? { type: 'put', store: 'thumbnails', key: project.id, value: { data: thumbnail.data } satisfies ThumbnailRecord }
          : { type: 'delete', store: 'thumbnails', key: project.id },
      ];
      const hash = project.image.contentHash;
      if ((await backend.get('images', hash)) === undefined) {
        const image: ImageRecord = { contentHash: hash, mimeType: project.image.metadata.mimeType, sizeBytes: project.image.source.size, data: project.image.source };
        ops.push({ type: 'put', store: 'images', key: hash, value: image });
      }
      // Replacing a project that referenced another photo: drop that photo if nobody else uses it.
      const previous = (await backend.get('projects', project.id)) as { image?: { contentHash?: unknown } } | undefined;
      const oldHash = previous?.image?.contentHash;
      if (typeof oldHash === 'string' && oldHash !== hash && !(await hashesInUse(project.id)).has(oldHash)) {
        ops.push({ type: 'delete', store: 'images', key: oldHash });
      }
      await backend.commit(ops);
    },

    async load(id: string): Promise<LoadedProject> {
      const record = await readRecord(id);
      const path = parsePathRecord(await backend.get('paths', id), record);
      const image = parseImageRecord(await backend.get('images', record.image.contentHash), record);
      const thumbRaw = record.thumbnail ? ((await backend.get('thumbnails', id)) as ThumbnailRecord | undefined) : undefined;
      const project: ArtworkProject = {
        schemaVersion: 1,
        id: record.id,
        name: record.name,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        image: { id: record.image.id, fileName: record.image.fileName, source: image.data, metadata: record.image.metadata, contentHash: record.image.contentHash },
        edit: record.edit,
        oneLine: record.oneLine,
        render: record.render,
        animation: record.animation,
        path,
        versions: record.versions,
      };
      const thumbnail = record.thumbnail && thumbRaw?.data ? { ...record.thumbnail, data: thumbRaw.data } : null;
      return { project, thumbnail, outdated: outdatedParts(record.versions) };
    },

    async list(): Promise<readonly ProjectSummary[]> {
      const thumbnails = new Map(await backend.entries('thumbnails'));
      const summaries = (await backend.entries('projects')).map(([key, raw]): ProjectSummary => {
        try {
          const r = parseProjectRecord(raw);
          const data = (thumbnails.get(key) as ThumbnailRecord | undefined)?.data;
          return {
            id: key,
            status: 'ok',
            name: r.name,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            detailLevel: r.oneLine.drawing.detailLevel,
            style: r.oneLine.drawing.style,
            custom: isCustomDrawing(r.oneLine.drawing),
            colorMode: r.render.colorMode,
            imageSize: { width: r.image.metadata.width, height: r.image.metadata.height },
            pointCount: r.path.pointCount,
            thumbnail: r.thumbnail && data ? { ...r.thumbnail, data } : null,
            favorite: r.favorite,
          };
        } catch (error) {
          // Unreadable projects stay visible (so they can be deleted) instead of breaking the gallery.
          const partial = raw as { name?: unknown; updatedAt?: unknown; createdAt?: unknown } | null;
          const text = (v: unknown) => (typeof v === 'string' ? v : '');
          return {
            id: key,
            status: error instanceof StorageError && error.code === 'incompatible-version' ? 'incompatible' : 'damaged',
            name: text(partial?.name),
            createdAt: text(partial?.createdAt),
            updatedAt: text(partial?.updatedAt),
            detailLevel: null,
            style: null,
            custom: false,
            colorMode: null,
            imageSize: null,
            pointCount: 0,
            thumbnail: null,
            favorite: (raw as { favorite?: unknown } | null)?.favorite === true,
          };
        }
      });
      // Favourites first, then newest first.
      return summaries.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    },

    async rename(id: string, name: string) {
      const trimmed = name.trim();
      // An empty name is never stored (unnamed works keep showing their default name).
      if (trimmed === '') throw new StorageError('invalid-project', 'Empty name');
      if (trimmed.length > STORAGE_LIMITS.maxNameLength) throw new StorageError('invalid-project', 'Name too long');
      const record = await readRecord(id);
      await backend.commit([{ type: 'put', store: 'projects', key: id, value: { ...record, name: trimmed, updatedAt: now().toISOString() } }]);
    },

    async setFavorite(id: string, favorite: boolean) {
      const record = await readRecord(id);
      if (record.favorite === favorite) return;
      await backend.commit([{ type: 'put', store: 'projects', key: id, value: { ...record, favorite } }]);
    },

    async duplicate(id: string, newId: string, name: string) {
      if (!newId || newId === id) throw new StorageError('invalid-project', 'A copy needs its own id');
      if ((await backend.get('projects', newId)) !== undefined) throw new StorageError('invalid-project', `Project ${newId} exists`);
      const trimmed = name.trim();
      if (trimmed.length > STORAGE_LIMITS.maxNameLength) throw new StorageError('invalid-project', 'Name too long');
      const record = await readRecord(id);
      const path = parsePathRecord(await backend.get('paths', id), record);
      const thumb = record.thumbnail ? ((await backend.get('thumbnails', id)) as ThumbnailRecord | undefined) : undefined;
      const date = now().toISOString();
      const copy: ProjectRecord = { ...record, id: newId, name: trimmed, createdAt: date, updatedAt: date, favorite: false, thumbnail: thumb?.data ? record.thumbnail : null };
      const ops: StorageOp[] = [
        { type: 'put', store: 'projects', key: newId, value: copy },
        { type: 'put', store: 'paths', key: newId, value: { coords: new Float32Array(path.coords) } satisfies PathRecord },
      ];
      if (thumb?.data) ops.push({ type: 'put', store: 'thumbnails', key: newId, value: { data: thumb.data } satisfies ThumbnailRecord });
      await backend.commit(ops);
    },

    async importProject(file, { id, imageId, toBinary }) {
      if (!id || (await backend.get('projects', id)) !== undefined) throw new StorageError('invalid-project', `Project ${id} exists`);
      const names: string[] = [];
      for (const [, raw] of await backend.entries('projects')) {
        const name = (raw as { name?: unknown } | null)?.name;
        if (typeof name === 'string') names.push(name);
      }
      const { record } = file;
      const name = importedName(record.name, names);
      const project: ArtworkProject = {
        schemaVersion: 1,
        id,
        name,
        createdAt: record.createdAt,
        updatedAt: now().toISOString(),
        image: { id: imageId, fileName: record.image.fileName, source: toBinary(file.image.bytes, file.image.mimeType), metadata: record.image.metadata, contentHash: record.image.contentHash },
        edit: record.edit,
        oneLine: record.oneLine,
        render: record.render,
        animation: record.animation,
        path: { coords: file.coords, bounds: record.path.bounds, meta: { ...record.path.meta, sourceImageId: imageId } },
        versions: record.versions,
      };
      const thumbnail = file.thumbnail ? { data: toBinary(file.thumbnail.bytes, file.thumbnail.mimeType), mimeType: file.thumbnail.mimeType, width: file.thumbnail.width, height: file.thumbnail.height } : null;
      await this.save(project, thumbnail);
      return { id, name };
    },

    async remove(id: string) {
      const used = await hashesInUse(id);
      const ops: StorageOp[] = [
        { type: 'delete', store: 'projects', key: id },
        { type: 'delete', store: 'paths', key: id },
        { type: 'delete', store: 'thumbnails', key: id },
      ];
      // Every stored photo no other project references goes too (also orphans of damaged projects).
      for (const [hash] of await backend.entries('images')) if (!used.has(hash)) ops.push({ type: 'delete', store: 'images', key: hash });
      await backend.commit(ops);
    },
  };
}
