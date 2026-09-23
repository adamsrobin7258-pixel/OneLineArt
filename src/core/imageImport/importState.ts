import { AnalysisError, type AnalysisErrorCode, type ImageAnalysis } from '../imageAnalysis';
import type { EngineErrorCode } from '../engine';
import type { OneLinePath, OriginalImage, ProcessedImage } from '../models';
import type { ImageImportErrorCode } from './errors';
import type { ImportedImage } from './types';

/**
 * Everything derived from ONE selected image. Replaced as a whole when the
 * image changes, so results of an old image can never mix with a new one.
 */
export interface ImageSession<TPreview> {
  readonly original: OriginalImage;
  readonly processed: ProcessedImage;
  readonly preview: TPreview;
  readonly analysisStatus: AnalysisStatus;
  /** Set only while analysisStatus is 'ready'; always belongs to `original`. */
  readonly analysis: ImageAnalysis | null;
  readonly analysisError: AnalysisErrorCode | null;
  readonly pathStatus: PathStatus;
  /** Set only while pathStatus is 'ready'; always generated from this session's analysis. */
  readonly path: OneLinePath | null;
  readonly pathError: PathErrorCode | null;
}

/** Path generation runs on request (not automatically on import). */
export type PathStatus = 'idle' | 'running' | 'ready' | 'failed';

export type PathErrorCode = EngineErrorCode | 'analysis-missing' | 'out-of-memory' | 'generation-failed';

export type AnalysisStatus = 'pending' | 'running' | 'ready' | 'failed';

export type ImportState<TPreview> =
  | { readonly status: 'empty' }
  | { readonly status: 'loading' | 'processing'; readonly requestId: number; readonly fileName: string }
  | { readonly status: 'ready'; readonly session: ImageSession<TPreview> }
  | { readonly status: 'error'; readonly error: ImageImportErrorCode; readonly fileName: string };

export type ImportStatus = ImportState<unknown>['status'];

export type ImportAction<TPreview> =
  | { readonly type: 'import-started'; readonly requestId: number; readonly fileName: string }
  | { readonly type: 'processing-started'; readonly requestId: number }
  | { readonly type: 'import-succeeded'; readonly requestId: number; readonly image: ImportedImage<TPreview> }
  | { readonly type: 'import-failed'; readonly requestId: number; readonly error: ImageImportErrorCode }
  | { readonly type: 'image-removed' }
  | { readonly type: 'analysis-started'; readonly imageId: string }
  | { readonly type: 'analysis-succeeded'; readonly imageId: string; readonly analysis: ImageAnalysis }
  | { readonly type: 'analysis-failed'; readonly imageId: string; readonly error: AnalysisErrorCode }
  | { readonly type: 'analysis-retry'; readonly imageId: string }
  | { readonly type: 'path-started'; readonly imageId: string }
  | { readonly type: 'path-succeeded'; readonly imageId: string; readonly path: OneLinePath }
  | { readonly type: 'path-failed'; readonly imageId: string; readonly error: PathErrorCode };

export const EMPTY_IMPORT_STATE: ImportState<never> = { status: 'empty' };

type PendingState = Extract<ImportState<never>, { status: 'loading' | 'processing' }>;

const isCurrent = (state: ImportState<unknown>, requestId: number): state is PendingState =>
  (state.status === 'loading' || state.status === 'processing') && state.requestId === requestId;

/**
 * EMPTY → LOADING → PROCESSING → READY, or → ERROR.
 * Starting a new import drops the previous session immediately. Actions of
 * superseded imports are ignored (the caller must release their preview).
 */
export function importReducer<TPreview>(state: ImportState<TPreview>, action: ImportAction<TPreview>): ImportState<TPreview> {
  switch (action.type) {
    case 'import-started':
      return { status: 'loading', requestId: action.requestId, fileName: action.fileName };
    case 'processing-started':
      return isCurrent(state, action.requestId) && state.status === 'loading' ? { ...state, status: 'processing' } : state;
    case 'import-succeeded':
      if (!isCurrent(state, action.requestId)) return state;
      return {
        status: 'ready',
        session: {
          ...action.image,
          analysisStatus: 'pending',
          analysis: null,
          analysisError: null,
          pathStatus: 'idle',
          path: null,
          pathError: null,
        },
      };
    case 'import-failed':
      if (!isCurrent(state, action.requestId)) return state;
      return { status: 'error', error: action.error, fileName: state.fileName };
    case 'image-removed':
      return EMPTY_IMPORT_STATE;
    case 'analysis-started':
    case 'analysis-succeeded':
    case 'analysis-failed':
    case 'analysis-retry':
      return analysisReducer(state, action);
    case 'path-started':
    case 'path-succeeded':
    case 'path-failed':
      return pathReducer(state, action);
  }
}

/**
 * Paths are accepted only for the session's own image, only once its analysis
 * exists, and only if the path says it was made for this image and canvas.
 */
function pathReducer<TPreview>(
  state: ImportState<TPreview>,
  action: Extract<ImportAction<TPreview>, { type: 'path-started' | 'path-succeeded' | 'path-failed' }>,
): ImportState<TPreview> {
  if (state.status !== 'ready' || state.session.original.id !== action.imageId) return state;
  const session = state.session;
  const update = (patch: Partial<ImageSession<TPreview>>): ImportState<TPreview> => ({ status: 'ready', session: { ...session, ...patch } });

  switch (action.type) {
    case 'path-started':
      if (session.pathStatus === 'running') return state;
      if (session.analysisStatus !== 'ready') return update({ pathStatus: 'failed', pathError: 'analysis-missing', path: null });
      return update({ pathStatus: 'running', pathError: null, path: null });
    case 'path-failed':
      return session.pathStatus === 'running' ? update({ pathStatus: 'failed', pathError: action.error, path: null }) : state;
    case 'path-succeeded': {
      if (session.pathStatus !== 'running') return state;
      const { meta, bounds } = action.path;
      if (meta.sourceImageId !== undefined && meta.sourceImageId !== session.original.id) return state;
      const { width, height } = session.processed.pixels;
      if (bounds.width !== width || bounds.height !== height) {
        return update({ pathStatus: 'failed', pathError: 'invalid-result', path: null });
      }
      return update({ pathStatus: 'ready', path: action.path, pathError: null });
    }
    default:
      return state;
  }
}

type AnalysisAction<TPreview> = Extract<
  ImportAction<TPreview>,
  { type: 'analysis-started' | 'analysis-succeeded' | 'analysis-failed' | 'analysis-retry' }
>;

/**
 * Analysis results are accepted only for the session's own image; anything
 * addressed to a previous image is dropped. A result that does not match the
 * session's working copy is rejected instead of silently used.
 */
function analysisReducer<TPreview>(state: ImportState<TPreview>, action: AnalysisAction<TPreview>): ImportState<TPreview> {
  if (state.status !== 'ready' || state.session.original.id !== action.imageId) return state;
  const session = state.session;
  const update = (patch: Partial<ImageSession<TPreview>>): ImportState<TPreview> => ({ status: 'ready', session: { ...session, ...patch } });

  switch (action.type) {
    case 'analysis-started':
      return session.analysisStatus === 'pending' ? update({ analysisStatus: 'running' }) : state;
    case 'analysis-retry':
      return session.analysisStatus === 'failed' ? update({ analysisStatus: 'pending', analysisError: null }) : state;
    case 'analysis-failed':
      return session.analysisStatus === 'running' ? update({ analysisStatus: 'failed', analysisError: action.error, analysis: null }) : state;
    case 'analysis-succeeded': {
      if (session.analysisStatus !== 'running') return state;
      const { meta } = action.analysis;
      if (meta.sourceImageId !== session.original.id) return state;
      const { width, height } = session.processed.pixels;
      if (meta.sourceSize.width !== width || meta.sourceSize.height !== height) {
        return update({ analysisStatus: 'failed', analysisError: 'unexpected-dimensions', analysis: null });
      }
      return update({ analysisStatus: 'ready', analysis: action.analysis, analysisError: null });
    }
  }
}

/** The working copy to analyse, or a typed error if there is none. */
export function requireAnalysisSource(state: ImportState<unknown>): ProcessedImage {
  if (state.status !== 'ready') throw new AnalysisError('no-image');
  const { processed } = state.session;
  if (!processed.pixels.data || processed.pixels.data.length === 0) throw new AnalysisError('image-unavailable');
  return processed;
}

/** True if a derived result belongs to the image currently in the session. */
export function belongsToSession(session: ImageSession<unknown>, sourceImageId: string): boolean {
  return session.original.id === sourceImageId;
}
