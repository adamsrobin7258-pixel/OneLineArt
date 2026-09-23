import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  EMPTY_IMPORT_STATE,
  analysisErrorCode,
  importErrorCode,
  importImage,
  importReducer,
  requireAnalysisSource,
  resolveOneLineSettings,
  DETAIL_LEVELS,
  type DrawingSettings,
  type EffectiveOneLineSettings,
  type ImportState,
  StorageError,
  type ArtworkProject,
} from '../../core';
import { runAnalysis, type AnalysisJob, type AnalysisOutcome } from '../../platform/browser/analysisRunner';
import { PathGenerationError, runPathGeneration, type PathJob, type PathOutcome } from '../../platform/browser/pathRunner';
import { bitmapDecoder } from '../../platform/browser/bitmapDecoder';
import { createId } from '../../platform/browser/ids';

export interface ImageImportController {
  readonly state: ImportState<ImageBitmap>;
  /** Replaces any current image. `null` (picker cancelled) changes nothing. */
  readonly selectFile: (file: File | null) => void;
  /** Back to EMPTY; frees all image data. */
  readonly removeImage: () => void;
  /** Re-runs a failed analysis of the current image. */
  readonly retryAnalysis: () => void;
  /** Diagnostics of the last finished analysis (developer view only). */
  readonly analysisRun: Omit<AnalysisOutcome, 'analysis'> | null;
  /** Changes the drawing configuration (detail level, seed, …) of the current image. */
  readonly setDrawing: (drawing: Partial<DrawingSettings>) => void;
  /**
   * Computes the path for the current configuration (or `target`) from the
   * EXISTING analysis. Cached results are reused; resolves when done or superseded.
   */
  readonly generatePath: (target?: EffectiveOneLineSettings) => Promise<void>;
  /** Computes all three detail levels one after another (developer comparison). */
  readonly generateAllLevels: () => Promise<void>;
  /** Metrics of the current configuration's path (developer view only). */
  readonly pathRun: PathRun | null;
  /** Metrics of every computed configuration of this image, by key. */
  readonly pathRuns: Readonly<Record<string, PathRun>>;
  /**
   * Reopens a stored project: decodes its original again and uses the stored
   * drawing as is (no analysis, no path generation). Replaces the current
   * image only on success; rejects with a StorageError otherwise.
   */
  readonly openProject: (project: ArtworkProject) => Promise<void>;
}

export type PathRun = Omit<PathOutcome, 'path'> & { readonly effective: EffectiveOneLineSettings };

/**
 * Owns the lifetime of imported image data. Exactly one image session exists
 * at a time; its preview is released as soon as it is replaced or removed,
 * and results of superseded imports are discarded.
 */
export function useImageImport(): ImageImportController {
  const [state, dispatch] = useReducer(importReducer<ImageBitmap>, EMPTY_IMPORT_STATE);
  const currentRequest = useRef(0);
  const currentPreview = useRef<ImageBitmap | null>(null);

  const releasePreview = useCallback(() => {
    if (currentPreview.current) bitmapDecoder.releasePreview(currentPreview.current);
    currentPreview.current = null;
  }, []);

  const selectFile = useCallback(
    (file: File | null) => {
      if (!file) return;
      const requestId = ++currentRequest.current;
      const isCurrent = () => currentRequest.current === requestId;
      releasePreview();
      dispatch({ type: 'import-started', requestId, fileName: file.name });

      importImage(file, {
        decoder: bitmapDecoder,
        createId,
        onPhase: (phase) => {
          if (phase === 'processing' && isCurrent()) dispatch({ type: 'processing-started', requestId });
        },
      }).then(
        (image) => {
          if (!isCurrent()) {
            bitmapDecoder.releasePreview(image.preview);
            return;
          }
          currentPreview.current = image.preview;
          dispatch({ type: 'import-succeeded', requestId, image });
        },
        (error: unknown) => {
          if (!isCurrent()) return;
          if (importErrorCode(error) === 'unknown') console.error('Image import failed', error);
          dispatch({ type: 'import-failed', requestId, error: importErrorCode(error) });
        },
      );
    },
    [releasePreview],
  );

  const openProject = useCallback(
    async (project: ArtworkProject): Promise<void> => {
      const requestId = ++currentRequest.current;
      let image;
      try {
        image = await importImage(project.image.source, { decoder: bitmapDecoder, createId: () => project.image.id });
      } catch (error) {
        console.error('Stored original could not be decoded', error);
        throw new StorageError('damaged', 'Stored original could not be decoded', { cause: error });
      }
      const discard = (error: StorageError) => {
        bitmapDecoder.releasePreview(image.preview);
        throw error;
      };
      if (currentRequest.current !== requestId) return discard(new StorageError('read-failed', 'Superseded'));
      if (image.original.contentHash !== project.image.contentHash) return discard(new StorageError('damaged', 'Stored original differs'));
      const { width, height } = image.processed.pixels;
      if (project.path.bounds.width !== width || project.path.bounds.height !== height) {
        return discard(new StorageError('incompatible-version', 'Working copy size differs from the stored drawing'));
      }
      releasePreview();
      currentPreview.current = image.preview;
      const restored = { ...image, original: { ...image.original, fileName: project.image.fileName } };
      dispatch({ type: 'import-started', requestId, fileName: project.image.fileName });
      dispatch({ type: 'import-succeeded', requestId, image: restored, restore: { oneLine: project.oneLine, path: project.path } });
    },
    [releasePreview],
  );

  const removeImage = useCallback(() => {
    currentRequest.current++;
    releasePreview();
    dispatch({ type: 'image-removed' });
  }, [releasePreview]);

  // Analysis: started once per image, cancelled as soon as the image changes.
  const [analysisRun, setAnalysisRun] = useState<Omit<AnalysisOutcome, 'analysis'> | null>(null);
  const analysisJob = useRef<AnalysisJob | null>(null);
  const imageId = state.status === 'ready' ? state.session.original.id : null;
  const analysisPending = state.status === 'ready' && state.session.analysisStatus === 'pending';

  useEffect(() => {
    if (!analysisPending || !imageId) return;
    let source;
    try {
      source = requireAnalysisSource(state);
    } catch (error) {
      console.error('Image analysis could not start', error);
      dispatch({ type: 'analysis-started', imageId });
      dispatch({ type: 'analysis-failed', imageId, error: analysisErrorCode(error) });
      return;
    }
    dispatch({ type: 'analysis-started', imageId });
    const job = runAnalysis(source);
    analysisJob.current = job;
    job.promise.then(
      ({ analysis, ...run }) => {
        setAnalysisRun(run);
        dispatch({ type: 'analysis-succeeded', imageId, analysis });
      },
      (error: unknown) => {
        console.error('Image analysis failed', error);
        dispatch({ type: 'analysis-failed', imageId, error: analysisErrorCode(error) });
      },
    );
    // Only the pending → started transition matters here; `state` is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisPending, imageId]);

  // Path generation: per configuration, from the existing analysis; one job at a time,
  // superseded jobs are cancelled; everything is dropped when the image changes.
  const [pathRuns, setPathRuns] = useState<Record<string, PathRun>>({});
  const pathJob = useRef<{ key: string; job: PathJob; settle: () => void; done: Promise<void> } | null>(null);
  const session = state.status === 'ready' ? state.session : null;

  const setDrawing = useCallback(
    (drawing: Partial<DrawingSettings>) => {
      if (imageId) dispatch({ type: 'drawing-changed', imageId, drawing });
    },
    [imageId],
  );

  const generatePath = useCallback(
    (target?: EffectiveOneLineSettings): Promise<void> => {
      if (!session) return Promise.resolve();
      const id = session.original.id;
      const effective = target ?? session.oneLine;
      const key = effective.key;
      if (session.paths[key]) return Promise.resolve();
      if (pathJob.current?.key === key) return pathJob.current.done;
      dispatch({ type: 'path-started', imageId: id, key });
      if (!session.analysis) return Promise.resolve(); // reducer records 'analysis-missing'

      if (pathJob.current) {
        pathJob.current.job.cancel();
        pathJob.current.settle();
      }
      const job = runPathGeneration(session.processed, session.analysis, effective.settings, effective.parameters, effective.engineId);
      let settle = () => {};
      const done = new Promise<void>((resolve) => {
        settle = resolve;
        job.promise.then(
          ({ path, ...run }) => {
            setPathRuns((runs) => ({ ...runs, [key]: { ...run, effective } }));
            dispatch({ type: 'path-succeeded', imageId: id, key, path });
            resolve();
          },
          (error: unknown) => {
            console.error('Path generation failed', error);
            dispatch({ type: 'path-failed', imageId: id, key, error: error instanceof PathGenerationError ? error.code : 'generation-failed' });
            resolve();
          },
        );
      }).finally(() => {
        if (pathJob.current?.job === job) pathJob.current = null;
      });
      pathJob.current = { key, job, settle, done };
      return done;
    },
    [session],
  );

  const generateAllLevels = useCallback(async () => {
    if (!session) return;
    for (const level of DETAIL_LEVELS) {
      await generatePath(resolveOneLineSettings({ ...session.oneLine.drawing, detailLevel: level, detail: null, smoothing: null }));
    }
  }, [session, generatePath]);

  useEffect(
    () => () => {
      analysisJob.current?.cancel();
      analysisJob.current = null;
      pathJob.current?.job.cancel();
      pathJob.current?.settle();
      pathJob.current = null;
      setAnalysisRun(null);
      setPathRuns({});
    },
    [imageId],
  );

  const retryAnalysis = useCallback(() => {
    if (imageId) dispatch({ type: 'analysis-retry', imageId });
  }, [imageId]);

  useEffect(
    () => () => {
      currentRequest.current++;
      releasePreview();
    },
    [releasePreview],
  );

  const pathRun = session ? (pathRuns[session.oneLine.key] ?? null) : null;

  return { state, selectFile, removeImage, retryAnalysis, analysisRun, setDrawing, generatePath, generateAllLevels, pathRun, pathRuns, openProject };
}
