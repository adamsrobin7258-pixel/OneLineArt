import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  EMPTY_IMPORT_STATE,
  analysisErrorCode,
  importErrorCode,
  importImage,
  importReducer,
  requireAnalysisSource,
  type ImportState,
} from '../../core';
import { runAnalysis, type AnalysisJob, type AnalysisOutcome } from '../../platform/browser/analysisRunner';
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
}

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

  useEffect(
    () => () => {
      analysisJob.current?.cancel();
      analysisJob.current = null;
      setAnalysisRun(null);
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

  return { state, selectFile, removeImage, retryAnalysis, analysisRun };
}
