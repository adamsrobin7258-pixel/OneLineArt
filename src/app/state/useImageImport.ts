import { useCallback, useEffect, useReducer, useRef } from 'react';
import { EMPTY_IMPORT_STATE, importErrorCode, importImage, importReducer, type ImportState } from '../../core';
import { bitmapDecoder } from '../../platform/browser/bitmapDecoder';
import { createId } from '../../platform/browser/ids';

export interface ImageImportController {
  readonly state: ImportState<ImageBitmap>;
  /** Replaces any current image. `null` (picker cancelled) changes nothing. */
  readonly selectFile: (file: File | null) => void;
  /** Back to EMPTY; frees all image data. */
  readonly removeImage: () => void;
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

  useEffect(
    () => () => {
      currentRequest.current++;
      releasePreview();
    },
    [releasePreview],
  );

  return { state, selectFile, removeImage };
}
