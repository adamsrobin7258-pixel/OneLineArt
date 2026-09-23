import { createPlayback, pause, play, replay, seek, tick, type PlaybackState } from '../../../core';
import type { ArtworkAnimator, FrameResult } from './artworkAnimator';

/** Live metrics of the preview (browser-specific, not reproducible by nature). */
export interface AnimationStats {
  readonly frameCount: number;
  /** Frames per second over the recent frames. */
  readonly fps: number;
  /** Frames that took noticeably longer than one display refresh. */
  readonly droppedFrames: number;
  readonly lastRenderMs: number;
  readonly averageRenderMs: number;
}

export interface AnimationLoop {
  play(): void;
  pause(): void;
  replay(): void;
  seek(progress: number): void;
  readonly state: () => PlaybackState;
  readonly stats: () => AnimationStats;
  readonly lastFrame: () => FrameResult | null;
  dispose(): void;
}

/** A frame is "dropped" when it took longer than this multiple of the expected 60 Hz interval. */
const DROPPED_FRAME_FACTOR = 1.5;
const EXPECTED_FRAME_MS = 1000 / 60;
const FPS_WINDOW = 30;

/**
 * requestAnimationFrame loop around the core playback: each frame reads the
 * clock, derives progress from elapsed time (not from frame numbers) and asks
 * the animator for that exact position.
 */
export function createAnimationLoop(
  animator: ArtworkAnimator,
  target: CanvasRenderingContext2D,
  durationMs: number,
  onFrame: (state: PlaybackState, frame: FrameResult, stats: AnimationStats) => void,
  initialProgress = 0,
): AnimationLoop {
  let state = initialProgress > 0 ? seek(createPlayback(durationMs), initialProgress, performance.now()) : createPlayback(durationMs);
  let raf = 0;
  let last: FrameResult | null = null;
  let frameCount = 0;
  let dropped = 0;
  let renderSum = 0;
  const deltas: number[] = [];
  let lastTime = 0;

  const stats = (): AnimationStats => {
    const mean = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
    return { frameCount, fps: mean > 0 ? 1000 / mean : 0, droppedFrames: dropped, lastRenderMs: last?.renderMs ?? 0, averageRenderMs: frameCount ? renderSum / frameCount : 0 };
  };

  const draw = () => {
    last = animator.renderAt(target, state.progress);
    frameCount++;
    renderSum += last.renderMs;
    onFrame(state, last, stats());
  };

  const frame = (now: number) => {
    raf = 0;
    if (lastTime) {
      const delta = now - lastTime;
      deltas.push(delta);
      if (deltas.length > FPS_WINDOW) deltas.shift();
      if (delta > EXPECTED_FRAME_MS * DROPPED_FRAME_FACTOR) dropped++;
    }
    lastTime = now;
    state = tick(state, now);
    draw();
    if (state.status === 'playing') raf = requestAnimationFrame(frame);
  };

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  draw(); // initial frame (progress 0 or the given position)

  return {
    play() {
      state = play(state, performance.now());
      lastTime = 0;
      schedule();
    },
    pause() {
      state = pause(state, performance.now());
      cancelAnimationFrame(raf);
      raf = 0;
      draw();
    },
    replay() {
      state = replay(state, performance.now());
      lastTime = 0;
      schedule();
    },
    seek(progress: number) {
      state = seek(state, progress, performance.now());
      draw();
    },
    state: () => state,
    stats,
    lastFrame: () => last,
    dispose() {
      cancelAnimationFrame(raf);
      raf = 0;
      animator.dispose();
    },
  };
}
