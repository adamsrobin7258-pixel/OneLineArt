import { ANIMATION_LIMITS, AnimationError } from './animationSettings';

export type PlaybackStatus = 'ready' | 'playing' | 'paused' | 'finished';

/**
 * Pure, time-based playback state (no timers): the platform passes the
 * current clock time; the timeline position follows elapsed time × speed,
 * so the result is independent of frame rate and dropped frames.
 *
 * Timeline = drawing (`durationMs`) + final hold (`holdMs`, the finished
 * artwork stays visible). `progress` is the DRAWING progress (1 during the hold).
 */
export interface PlaybackState {
  readonly status: PlaybackStatus;
  /** Linear drawing progress 0..1 (before easing); 1 while holding. */
  readonly progress: number;
  /** Time the line is being drawn (at 1× speed). */
  readonly durationMs: number;
  /** Time the finished artwork stays visible afterwards. */
  readonly holdMs: number;
  /** Position on the whole timeline, 0 … durationMs + holdMs. */
  readonly positionMs: number;
  readonly speed: number;
  /** Clock time and timeline position when playing (re)started. */
  readonly anchorTimeMs: number;
  readonly anchorPositionMs: number;
}

function check(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new AnimationError('invalid-settings', `${name} must be finite (got ${value})`);
  return value;
}

const totalMs = (s: PlaybackState) => s.durationMs + s.holdMs;
const at = (s: PlaybackState, positionMs: number): PlaybackState => {
  const position = Math.min(totalMs(s), Math.max(0, positionMs));
  return { ...s, positionMs: position, progress: Math.min(1, position / s.durationMs) };
};

export function createPlayback(durationMs: number, speed = 1, holdMs = 0): PlaybackState {
  return {
    status: 'ready',
    progress: 0,
    durationMs: Math.min(ANIMATION_LIMITS.durationMs.max, Math.max(ANIMATION_LIMITS.durationMs.min, check('durationMs', durationMs))),
    holdMs: Math.max(0, check('holdMs', holdMs)),
    positionMs: 0,
    speed: Math.min(ANIMATION_LIMITS.speed.max, Math.max(ANIMATION_LIMITS.speed.min, check('speed', speed))),
    anchorTimeMs: 0,
    anchorPositionMs: 0,
  };
}

/** Advances a playing state to `nowMs`; other states are returned unchanged. */
export function tick(state: PlaybackState, nowMs: number): PlaybackState {
  if (state.status !== 'playing') return state;
  const elapsed = Math.max(0, check('nowMs', nowMs) - state.anchorTimeMs);
  const next = at(state, state.anchorPositionMs + elapsed * state.speed);
  return next.positionMs >= totalMs(state) ? { ...next, status: 'finished' } : next;
}

/** Starts or resumes at the current position; a finished animation starts over. */
export function play(state: PlaybackState, nowMs: number): PlaybackState {
  if (state.status === 'playing') return state;
  const from = state.status === 'finished' ? at(state, 0) : state;
  return { ...from, status: 'playing', anchorTimeMs: check('nowMs', nowMs), anchorPositionMs: from.positionMs };
}

/** Freezes the exact current position (advancing to `nowMs` first). */
export function pause(state: PlaybackState, nowMs: number): PlaybackState {
  if (state.status !== 'playing') return state;
  const current = tick(state, nowMs);
  return current.status === 'finished' ? current : { ...current, status: 'paused' };
}

/** Back to the beginning and play. */
export function replay(state: PlaybackState, nowMs: number): PlaybackState {
  return { ...at(state, 0), status: 'playing', anchorTimeMs: check('nowMs', nowMs), anchorPositionMs: 0 };
}

/** Jumps to a drawing progress without playing (1 = the finished artwork, end of the timeline). */
export function seek(state: PlaybackState, progress: number, nowMs: number): PlaybackState {
  const p = Math.min(1, Math.max(0, check('progress', progress)));
  const next = at(state, p >= 1 ? totalMs(state) : p * state.durationMs);
  const status = p >= 1 ? 'finished' : state.status === 'playing' ? 'playing' : 'paused';
  return { ...next, status, anchorTimeMs: check('nowMs', nowMs), anchorPositionMs: next.positionMs };
}

/** Jumps to a timeline position (ms, incl. the hold) keeping play/pause; the end counts as finished. */
export function seekPosition(state: PlaybackState, positionMs: number, nowMs: number): PlaybackState {
  const next = at(state, check('positionMs', positionMs));
  const status = next.positionMs >= totalMs(state) ? 'finished' : state.status === 'playing' ? 'playing' : next.positionMs > 0 ? 'paused' : state.status;
  return { ...next, status, anchorTimeMs: check('nowMs', nowMs), anchorPositionMs: next.positionMs };
}

/** Changes the speed without moving the line (re-anchors at the current position). */
export function setSpeed(state: PlaybackState, speed: number, nowMs: number): PlaybackState {
  const current = tick(state, nowMs);
  const next = Math.min(ANIMATION_LIMITS.speed.max, Math.max(ANIMATION_LIMITS.speed.min, check('speed', speed)));
  return { ...current, speed: next, anchorTimeMs: nowMs, anchorPositionMs: current.positionMs };
}

/** Elapsed timeline time (ms at 1× speed, incl. the hold) for display. */
export const elapsedMs = (state: PlaybackState): number => state.positionMs;

/** Whole timeline length: drawing + final hold. */
export const playbackTotalMs = (state: PlaybackState): number => totalMs(state);

/** True while the line is complete and the finished artwork is being held. */
export const isHolding = (state: PlaybackState): boolean => state.status === 'playing' && state.progress >= 1;
