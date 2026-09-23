import { frameTimesMs, progressAtTime } from '../animation/animationSettings';
import type { Size } from '../models';
import { ExportError, throwIfCancelled, type CancelSignal } from './errors';
import { EXPORT_LIMITS, sanitizeVideoExportSettings, type VideoExportSettings } from './exportSettings';
import type { ExportFile, ExportPhase } from './exportState';

/**
 * Every frame of a video, computed up front and independent of device speed:
 * frame k is shown at k/fps and draws the path up to progressAtTime(k/fps).
 * The last frame (t = duration) is the complete artwork.
 */
export interface VideoFramePlan {
  readonly fps: number;
  readonly durationMs: number;
  readonly frameCount: number;
  /** Presentation time of each frame in ms (0, 1000/fps, …, duration). */
  readonly timesMs: readonly number[];
  /** Drawing progress 0…1 of each frame (same function as the live animation). */
  readonly progress: readonly number[];
  /** Display duration of one frame in ms. */
  readonly frameDurationMs: number;
}

export function planVideoFrames(input: Partial<VideoExportSettings>): VideoFramePlan {
  const { fps, durationMs } = sanitizeVideoExportSettings(input);
  const animation = { durationMs, fps, pacing: 'constant-speed', easing: 'linear' } as const;
  const timesMs = frameTimesMs(animation);
  if (timesMs.length > EXPORT_LIMITS.videoFrames) throw new ExportError('size-unsupported', `${timesMs.length} frames exceed the limit`);
  return {
    fps,
    durationMs,
    frameCount: timesMs.length,
    timesMs,
    progress: timesMs.map((t) => progressAtTime(t, animation)),
    frameDurationMs: 1000 / fps,
  };
}

/** What the platform encoder can do for a given frame size and rate. */
export type VideoCapability =
  | { readonly supported: true; readonly codec: string; readonly container: string; readonly mimeType: string; readonly extension: string }
  | { readonly supported: false; readonly reason: 'encoder-unavailable' | 'codec-unsupported' };

/**
 * Platform video encoder (browser: WebCodecs; later native). Frames are
 * pushed one at a time; the implementation must apply backpressure in
 * `addFrame` so that never more than a few frames are held in memory.
 */
export interface VideoEncoderPort<TData> {
  probe(size: Size, fps: number): Promise<VideoCapability>;
  open(config: { readonly size: Size; readonly fps: number }): Promise<VideoEncodingSession<TData>>;
}

export interface VideoEncodingSession<TData> {
  /** Encodes the frame currently drawn on the session's surface. */
  addFrame(timestampMs: number, durationMs: number): Promise<void>;
  /** Flushes and finalizes the file (not cancellable once started). */
  finish(): Promise<{ readonly data: TData; readonly sizeBytes: number; readonly mimeType: string }>;
  /** Discards everything written so far. */
  cancel(): Promise<void>;
}

export interface RunVideoExportParams<TData> {
  readonly plan: VideoFramePlan;
  readonly session: VideoEncodingSession<TData>;
  /** Draws frame `index` (drawing progress `progress`) onto the session's surface. */
  readonly renderFrame: (progress: number, index: number) => void;
  readonly fileName: string;
  readonly signal?: CancelSignal;
  readonly onPhase?: (phase: ExportPhase) => void;
  /** 0…1; frames count up to FRAME_SHARE, finalizing the file is the rest. */
  readonly onProgress?: (progress: number) => void;
}

/** Share of the progress bar for rendering + encoding frames; finalizing the file takes the rest. */
export const FRAME_PROGRESS_SHARE = 0.98;

/**
 * Deterministic frame loop: render frame k → hand it to the encoder → next.
 * Frames are processed strictly one after another (no frame buffer), and a
 * cancel request is honoured between frames. Once finalizing has started it
 * cannot be interrupted; a cancel during it discards the result instead.
 */
export async function runVideoExport<TData>(params: RunVideoExportParams<TData>): Promise<ExportFile<TData>> {
  const { plan, session, renderFrame, signal, onPhase, onProgress } = params;
  try {
    onPhase?.('rendering');
    for (let k = 0; k < plan.frameCount; k++) {
      throwIfCancelled(signal);
      renderFrame(plan.progress[k]!, k);
      await session.addFrame(plan.timesMs[k]!, plan.frameDurationMs);
      onProgress?.(((k + 1) / plan.frameCount) * FRAME_PROGRESS_SHARE);
    }
    throwIfCancelled(signal);
  } catch (error) {
    await session.cancel().catch(() => undefined);
    throw error;
  }
  onPhase?.('encoding');
  const result = await session.finish();
  throwIfCancelled(signal);
  if (!(result.sizeBytes > 0)) throw new ExportError('encoding-failed', 'Encoder produced an empty file');
  onProgress?.(1);
  return { fileName: params.fileName, mimeType: result.mimeType, sizeBytes: result.sizeBytes, data: result.data };
}
