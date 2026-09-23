import type { ExportErrorCode } from './errors';

export type ExportKind = 'image' | 'video';
export type ExportStatus = 'idle' | 'preparing' | 'rendering' | 'encoding' | 'ready' | 'failed' | 'cancelled';
export type ExportPhase = 'preparing' | 'rendering' | 'encoding';

/** A finished file, ready to hand to the platform (download, share sheet). */
export interface ExportFile<TData = unknown> {
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly data: TData;
}

export interface ExportState<TData = unknown> {
  readonly status: ExportStatus;
  readonly kind: ExportKind | null;
  /** Identifies the running export; events of older jobs are ignored. */
  readonly jobId: number;
  /** 0…1 within the whole export (monotonic). */
  readonly progress: number;
  readonly error: ExportErrorCode | null;
  readonly file: ExportFile<TData> | null;
}

export type ExportEvent<TData = unknown> =
  | { readonly type: 'started'; readonly jobId: number; readonly kind: ExportKind }
  | { readonly type: 'phase'; readonly jobId: number; readonly phase: ExportPhase }
  | { readonly type: 'progress'; readonly jobId: number; readonly progress: number }
  | { readonly type: 'succeeded'; readonly jobId: number; readonly file: ExportFile<TData> }
  | { readonly type: 'failed'; readonly jobId: number; readonly error: ExportErrorCode }
  | { readonly type: 'cancelled'; readonly jobId: number }
  | { readonly type: 'reset' };

export const IDLE_EXPORT_STATE: ExportState<never> = { status: 'idle', kind: null, jobId: 0, progress: 0, error: null, file: null };

const PHASE_ORDER: readonly ExportPhase[] = ['preparing', 'rendering', 'encoding'];
const isRunning = (status: ExportStatus): status is ExportPhase => (PHASE_ORDER as readonly string[]).includes(status);

/**
 * Export lifecycle: idle → preparing → rendering → encoding → ready,
 * or → failed / cancelled from any running phase. Phases only move forward,
 * progress never goes back, and a finished/cancelled job cannot be revived
 * by late events (e.g. an encoder that resolves after "Abbrechen").
 */
export function exportReducer<TData>(state: ExportState<TData>, event: ExportEvent<TData>): ExportState<TData> {
  if (event.type === 'reset') return isRunning(state.status) ? state : { ...IDLE_EXPORT_STATE, jobId: state.jobId };
  if (event.type === 'started') {
    if (isRunning(state.status) || event.jobId <= state.jobId) return state;
    return { status: 'preparing', kind: event.kind, jobId: event.jobId, progress: 0, error: null, file: null };
  }
  if (event.jobId !== state.jobId || !isRunning(state.status)) return state;
  switch (event.type) {
    case 'phase':
      return PHASE_ORDER.indexOf(event.phase) > PHASE_ORDER.indexOf(state.status) ? { ...state, status: event.phase } : state;
    case 'progress': {
      const p = Number.isFinite(event.progress) ? Math.min(1, Math.max(0, event.progress)) : state.progress;
      return p > state.progress ? { ...state, progress: p } : state;
    }
    case 'succeeded':
      return { ...state, status: 'ready', progress: 1, file: event.file };
    case 'failed':
      return event.error === 'cancelled' ? { ...state, status: 'cancelled' } : { ...state, status: 'failed', error: event.error };
    case 'cancelled':
      return { ...state, status: 'cancelled' };
  }
}

export const isExportRunning = (state: ExportState<unknown>): boolean => isRunning(state.status);
