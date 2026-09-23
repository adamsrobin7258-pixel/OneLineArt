import {
  ExportError,
  exportFileName,
  planVideoFrames,
  runVideoExport,
  sanitizeVideoExportSettings,
  settingsForOpaqueOutput,
  throwIfCancelled,
  videoFrameSize,
  type CancelSignal,
  type ExportFile,
  type ExportPhase,
  type Size,
  type AnimationDirection,
  type NormalizedPoint,
  type VideoExportSettings,
} from '../../../core';
import { createArtworkAnimator } from '../animation/artworkAnimator';
import { asExportError, yieldToUi } from './encodeCanvas';
import type { BrowserExportSource } from './imageExporter';
import { webCodecsEncoder, type BrowserVideoEncoder } from './webCodecsEncoder';

export interface VideoExportRequest {
  readonly source: BrowserExportSource;
  /** `durationMs` = the drawing time (duration / speed), as in the preview. */
  readonly settings: Partial<VideoExportSettings>;
  /** Drawing order — the same as the preview's (the path is never changed). */
  readonly direction?: AnimationDirection;
  readonly startPoint?: NormalizedPoint | null;
  readonly signal?: CancelSignal;
  readonly onPhase?: (phase: ExportPhase) => void;
  readonly onProgress?: (progress: number) => void;
  readonly date?: Date;
  /** Encoder to use (tests inject one to inspect frames before encoding). */
  readonly encoder?: BrowserVideoEncoder;
}

export interface VideoExportTimings {
  readonly prepareMs: number;
  /** Drawing all frames (sum). */
  readonly frameRenderMs: number;
  /** Everything after drawing: handing frames to the encoder and finalizing the file. */
  readonly encodeMs: number;
  readonly totalMs: number;
  readonly frameCount: number;
  readonly averageFrameMs: number;
}

/**
 * Creation video: every frame is rendered from the stored OneLinePath at its
 * precomputed time (k / fps) — independent of device speed, no screen or
 * canvas recording, no requestAnimationFrame. Frames go to the encoder one by
 * one. The last frame is the complete artwork, drawn like the static render.
 */
export async function exportCreationVideo(request: VideoExportRequest): Promise<ExportFile<Blob> & { readonly timings: VideoExportTimings; readonly size: Size }> {
  const started = performance.now();
  const { source, signal, onPhase, onProgress } = request;
  const encoder = request.encoder ?? webCodecsEncoder;
  onPhase?.('preparing');
  const settings = sanitizeVideoExportSettings(request.settings);
  const plan = planVideoFrames(settings);
  const { size } = videoFrameSize(source.path.bounds, settings.resolution);

  const capability = await encoder.probe(size, settings.fps);
  if (!capability.supported) throw new ExportError(capability.reason);
  throwIfCancelled(signal);
  await yieldToUi();

  let animator;
  try {
    animator = createArtworkAnimator({
      path: source.path,
      settings: settingsForOpaqueOutput(source.render),
      longEdge: Math.max(size.width, size.height),
      image: source.image,
      backgroundImage: source.backgroundImage,
      direction: request.direction ?? 'forward',
      startPoint: request.startPoint ?? null,
    });
  } catch (error) {
    throw asExportError(error, 'out-of-memory');
  }
  let frameRenderMs = 0;
  try {
    if (animator.size.width !== size.width || animator.size.height !== size.height) throw new ExportError('size-unsupported', 'Frame size mismatch');
    const session = await encoder.open({ size, fps: settings.fps });
    const prepareMs = performance.now() - started;
    const ctx = session.ctx;
    const fileName = exportFileName({ projectName: source.projectName, date: request.date ?? new Date(), extension: capability.extension });
    const file = await runVideoExport({
      plan,
      session,
      fileName,
      ...(signal ? { signal } : {}),
      ...(onPhase ? { onPhase } : {}),
      ...(onProgress ? { onProgress } : {}),
      renderFrame: (progress) => {
        const t = performance.now();
        // Frames are drawn in order from a fresh animator: deterministic for equal inputs.
        animator.renderAt(ctx, progress);
        frameRenderMs += performance.now() - t;
      },
    });
    const totalMs = performance.now() - started;
    return {
      ...file,
      size,
      timings: {
        prepareMs,
        frameRenderMs,
        encodeMs: totalMs - prepareMs - frameRenderMs,
        totalMs,
        frameCount: plan.frameCount,
        averageFrameMs: frameRenderMs / plan.frameCount,
      },
    };
  } catch (error) {
    throw asExportError(error);
  } finally {
    animator.dispose();
  }
}
