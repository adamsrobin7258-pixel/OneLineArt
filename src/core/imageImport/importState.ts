import type { ImageAnalysis } from '../imageAnalysis';
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
  /** Filled in part 3. */
  readonly analysis: ImageAnalysis | null;
  /** Filled in part 4. */
  readonly path: OneLinePath | null;
}

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
  | { readonly type: 'image-removed' };

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
      return { status: 'ready', session: { ...action.image, analysis: null, path: null } };
    case 'import-failed':
      if (!isCurrent(state, action.requestId)) return state;
      return { status: 'error', error: action.error, fileName: state.fileName };
    case 'image-removed':
      return EMPTY_IMPORT_STATE;
  }
}

/** True if a derived result belongs to the image currently in the session. */
export function belongsToSession(session: ImageSession<unknown>, sourceImageId: string): boolean {
  return session.original.id === sourceImageId;
}
