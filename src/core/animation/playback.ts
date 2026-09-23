import { ANIMATION_LIMITS, AnimationError } from './animationSettings';

export type PlaybackStatus = 'ready' | 'playing' | 'paused' | 'finished';

/**
 * Pure, time-based playback state (no timers): the platform passes the
 * current clock time; progress follows elapsed time × speed / duration,
 * so the result is independent of frame rate and dropped frames.
 */
export interface PlaybackState {
  readonly status: PlaybackStatus;
  /** Linear time progress 0..1 (before easing). */
  readonly progress: number;
  readonly durationMs: number;
  readonly speed: number;
  /** Clock time and progress when playing (re)started. */
  readonly anchorTimeMs: number;
  readonly anchorProgress: number;
}

function check(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new AnimationError('invalid-settings', `${name} must be finite (got ${value})`);
  return value;
}

export function createPlayback(durationMs: number, speed = 1): PlaybackState {
  return {
    status: 'ready',
    progress: 0,
    durationMs: Math.min(ANIMATION_LIMITS.durationMs.max, Math.max(ANIMATION_LIMITS.durationMs.min, check('durationMs', durationMs))),
    speed: Math.min(ANIMATION_LIMITS.speed.max, Math.max(ANIMATION_LIMITS.speed.min, check('speed', speed))),
    anchorTimeMs: 0,
    anchorProgress: 0,
  };
}

/** Advances a playing state to `nowMs`; other states are returned unchanged. */
export function tick(state: PlaybackState, nowMs: number): PlaybackState {
  if (state.status !== 'playing') return state;
  const elapsed = Math.max(0, check('nowMs', nowMs) - state.anchorTimeMs);
  const progress = Math.min(1, state.anchorProgress + (elapsed * state.speed) / state.durationMs);
  return progress >= 1 ? { ...state, status: 'finished', progress: 1 } : { ...state, progress };
}

/** Starts or resumes at the current progress; a finished animation starts over. */
export function play(state: PlaybackState, nowMs: number): PlaybackState {
  if (state.status === 'playing') return state;
  const from = state.status === 'finished' ? 0 : state.progress;
  return { ...state, status: 'playing', progress: from, anchorTimeMs: check('nowMs', nowMs), anchorProgress: from };
}

/** Freezes the exact current position (advancing to `nowMs` first). */
export function pause(state: PlaybackState, nowMs: number): PlaybackState {
  if (state.status !== 'playing') return state;
  const current = tick(state, nowMs);
  return current.status === 'finished' ? current : { ...current, status: 'paused' };
}

/** Back to the beginning and play. */
export function replay(state: PlaybackState, nowMs: number): PlaybackState {
  return { ...state, status: 'playing', progress: 0, anchorTimeMs: check('nowMs', nowMs), anchorProgress: 0 };
}

/** Jumps to a progress without playing (e.g. 1 = show the finished artwork). */
export function seek(state: PlaybackState, progress: number, nowMs: number): PlaybackState {
  const p = Math.min(1, Math.max(0, check('progress', progress)));
  const status = p >= 1 ? 'finished' : state.status === 'playing' ? 'playing' : 'paused';
  return { ...state, status, progress: p, anchorTimeMs: check('nowMs', nowMs), anchorProgress: p };
}

/** Changes the speed without moving the line (re-anchors at the current position). */
export function setSpeed(state: PlaybackState, speed: number, nowMs: number): PlaybackState {
  const current = tick(state, nowMs);
  const next = Math.min(ANIMATION_LIMITS.speed.max, Math.max(ANIMATION_LIMITS.speed.min, check('speed', speed)));
  return { ...current, speed: next, anchorTimeMs: nowMs, anchorProgress: current.progress };
}

/** Elapsed drawing time (ms at 1× speed) for display. */
export const elapsedMs = (state: PlaybackState): number => state.progress * state.durationMs;
