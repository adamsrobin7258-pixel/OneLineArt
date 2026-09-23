import { useCallback, useMemo, useState } from 'react';
import {
  assembleProject,
  createProjectRepository,
  storageErrorCode,
  type ImageSession,
  type LoadedProject,
  type ProjectRepository,
  type ProjectSummary,
  type RenderSettings,
  type StorageErrorCode,
  type AnimationSettings,
} from '../../core';
import { createId } from '../../platform/browser/ids';
import { createIndexedDbBackend } from '../../platform/browser/storage/indexedDbBackend';
import { createThumbnail } from '../../platform/browser/storage/thumbnail';

let sharedRepository: ProjectRepository | null = null;
/** One repository per app instance (one IndexedDB connection). */
export const projectRepository = (): ProjectRepository => (sharedRepository ??= createProjectRepository(createIndexedDbBackend()));

/** The stored project the current image belongs to (saving again updates it). */
export interface LinkedProject {
  readonly imageId: string;
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

/** What was saved last; equal references ⇒ nothing changed since. */
interface SavedState {
  readonly projectId: string;
  readonly path: unknown;
  readonly render: string;
  /** Animation choices as saved (duration, speed, direction, start point). */
  readonly animation: string;
}

const renderKey = (render: RenderSettings) => JSON.stringify(render);

/** What the user chooses for the drawing process (saved with the project). */
export type AnimationChoice = Pick<AnimationSettings, 'durationMs' | 'speed' | 'direction' | 'startPoint'>;
const animationKey = (a: AnimationChoice) =>
  JSON.stringify([a.durationMs, a.speed ?? 1, a.direction ?? 'forward', a.startPoint ? [a.startPoint.x, a.startPoint.y] : null]);

export interface ProjectsController {
  readonly linked: LinkedProject | null;
  readonly saveStatus: SaveStatus;
  readonly saveError: StorageErrorCode | null;
  /** True if the current drawing + settings are stored unchanged. */
  readonly isSaved: (session: ImageSession<ImageBitmap>, render: RenderSettings, animation: AnimationChoice) => boolean;
  readonly save: (session: ImageSession<ImageBitmap>, render: RenderSettings, animation: AnimationChoice) => Promise<void>;
  readonly list: () => Promise<readonly ProjectSummary[]>;
  readonly load: (id: string) => Promise<LoadedProject>;
  readonly remove: (id: string) => Promise<void>;
  readonly rename: (id: string, name: string) => Promise<void>;
  /** Marks the opened project as the current one. */
  readonly link: (loaded: LoadedProject) => void;
}

/**
 * Explicit saving (user action) of the CURRENT session as an ArtworkProject.
 * The gallery reads the same repository; no second project logic exists.
 */
export function useProjects(): ProjectsController {
  const repository = useMemo(() => projectRepository(), []);
  const [linked, setLinked] = useState<LinkedProject | null>(null);
  const [saved, setSaved] = useState<SavedState | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<StorageErrorCode | null>(null);

  const linkedFor = useCallback((session: ImageSession<ImageBitmap>) => (linked?.imageId === session.original.id ? linked : null), [linked]);

  const isSaved = useCallback(
    (session: ImageSession<ImageBitmap>, render: RenderSettings, animation: AnimationChoice) => {
      const current = linkedFor(session);
      return !!current && saved?.projectId === current.id && saved.path === session.path && saved.render === renderKey(render) && saved.animation === animationKey(animation);
    },
    [linkedFor, saved],
  );

  const save = useCallback(
    async (session: ImageSession<ImageBitmap>, render: RenderSettings, animation: AnimationChoice) => {
      const path = session.path;
      if (!path) return;
      const current = linkedFor(session);
      setSaveStatus('saving');
      setSaveError(null);
      try {
        const project = assembleProject({
          id: current?.id ?? createId(),
          name: current?.name ?? '',
          createdAt: current?.createdAt ?? null,
          now: new Date(),
          image: session.original,
          edit: session.edit,
          oneLine: session.oneLine,
          path,
          render,
          animation: { ...animation, fps: 30, pacing: 'constant-speed', easing: 'linear' },
        });
        const thumbnail = await createThumbnail({ path, render, image: session.processed.pixels, backgroundImage: session.preview });
        await repository.save(project, thumbnail);
        setLinked({ imageId: session.original.id, id: project.id, name: project.name, createdAt: project.createdAt });
        setSaved({ projectId: project.id, path, render: renderKey(render), animation: animationKey(animation) });
        setSaveStatus('saved');
      } catch (error) {
        console.error('Saving the project failed', error);
        setSaveError(storageErrorCode(error) === 'read-failed' ? 'write-failed' : storageErrorCode(error));
        setSaveStatus('failed');
      }
    },
    [linkedFor, repository],
  );

  const remove = useCallback(
    async (id: string) => {
      await repository.remove(id);
      // Deleting the open project keeps the current work, just no longer linked to storage.
      setLinked((l) => (l?.id === id ? null : l));
      setSaved((s) => (s?.projectId === id ? null : s));
    },
    [repository],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      await repository.rename(id, name);
      setLinked((l) => (l?.id === id ? { ...l, name: name.trim() } : l));
    },
    [repository],
  );

  const link = useCallback((loaded: LoadedProject) => {
    const { project } = loaded;
    setLinked({ imageId: project.image.id, id: project.id, name: project.name, createdAt: project.createdAt });
    setSaved({ projectId: project.id, path: project.path, render: renderKey(project.render), animation: animationKey(project.animation) });
    setSaveStatus('idle');
  }, []);

  return {
    linked,
    saveStatus,
    saveError,
    isSaved,
    save,
    list: useCallback(() => repository.list(), [repository]),
    load: useCallback((id: string) => repository.load(id), [repository]),
    remove,
    rename,
    link,
  };
}
