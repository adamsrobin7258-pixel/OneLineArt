import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { isHolding, playbackTotalMs, type ImageSession, type PlaybackStatus } from '../../core';
import { createAnimationLoop, type AnimationLoop, type AnimationStats } from '../../platform/browser/animation/animationLoop';
import { createArtworkAnimator } from '../../platform/browser/animation/artworkAnimator';
import { isAnalysisDebugEnabled } from '../../platform/browser/debugFlags';
import { Button } from '../../ui/components/Button';
import { Icon } from '../../ui/components/Icon';
import { DisplayChoice, DurationChoice } from '../controls';
import { PREVIEW_RENDER_EDGE } from '../preview/previewConfig';
import type { RenderSettingsController } from '../state/useRenderSettings';

interface AnimationScreenProps {
  session: ImageSession<ImageBitmap>;
  render: RenderSettingsController;
  durationMs: number;
  onDurationChange: (durationMs: number) => void;
  onBack: () => void;
  onContinue: () => void;
}

const formatTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

interface Debug {
  readonly progress: number;
  readonly visible: number;
  readonly total: number;
  readonly stats: AnimationStats;
}

/**
 * Step 3: watch the drawing being made. Plays the very OneLinePath of the
 * artwork through the same renderer; nothing is recomputed while playing.
 * After the line is complete the finished artwork stays for FINAL_HOLD_MS.
 */
export function AnimationScreen({ session, render, durationMs, onDurationChange, onBack, onContinue }: AnimationScreenProps) {
  const { path } = session;
  const { renderSettings } = render;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const loopRef = useRef<AnimationLoop | null>(null);
  const [status, setStatus] = useState<PlaybackStatus>('ready');
  const [position, setPosition] = useState({ elapsed: 0, total: durationMs });
  const [debug, setDebug] = useState<Debug | null>(null);
  const showDebug = useMemo(() => isAnalysisDebugEnabled(), []);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  // (Re)build the animation when path, rendering or duration change — keeping position and play state.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!path || !canvas || !ctx) return;
    const previous = loopRef.current?.state();
    const animator = createArtworkAnimator({
      path,
      settings: renderSettings,
      longEdge: PREVIEW_RENDER_EDGE,
      image: session.processed.pixels,
      backgroundImage: session.preview,
    });
    canvas.width = animator.size.width;
    canvas.height = animator.size.height;
    setSize(animator.size);
    let lastUi = 0;
    const loop = createAnimationLoop(
      animator,
      ctx,
      durationMs,
      (state, frame, stats) => {
        // Every frame: progress bar + test hooks via the DOM (cheap); React state at most ~10×/s.
        const total = playbackTotalMs(state);
        if (barRef.current) barRef.current.style.transform = `scaleX(${state.positionMs / total})`;
        canvas.dataset.progress = state.progress.toFixed(4);
        canvas.dataset.status = state.status;
        canvas.dataset.phase = state.status === 'ready' ? 'ready' : isHolding(state) || state.status === 'finished' ? 'hold' : 'drawing';
        canvas.dataset.positionMs = String(Math.round(state.positionMs));
        const now = performance.now();
        if (now - lastUi > 100 || state.status !== 'playing') {
          lastUi = now;
          setStatus(state.status);
          setPosition({ elapsed: state.positionMs, total });
          if (showDebug) setDebug({ progress: state.progress, visible: frame.visibleLength, total: animator.index.totalLength, stats });
        }
      },
      // Same drawing progress after a change of duration; same timeline position otherwise.
      previous ? (previous.durationMs === durationMs ? previous.positionMs : previous.progress * durationMs) : 0,
    );
    loopRef.current = loop;
    if (previous?.status === 'playing') loop.play();
    return () => loop.dispose();
  }, [path, renderSettings, durationMs, session.processed.pixels, session.preview, showDebug]);

  const playing = status === 'playing';
  // Reads the live playback state (React state is throttled), so quick presses always toggle correctly.
  const toggle = () => {
    const loop = loopRef.current;
    if (!loop) return;
    if (loop.state().status === 'playing') loop.pause();
    else loop.play();
  };
  const percent = position.total > 0 ? Math.round((position.elapsed / position.total) * 100) : 0;

  return (
    <section className="animation" data-testid="animation-screen" data-status={status}>
      <div className="animation__stage">
        <div className="animation__frame" style={size ? ({ '--ratio': size.width / size.height } as CSSProperties) : undefined}>
          <canvas ref={canvasRef} className="animation__canvas" data-testid="animation-canvas" role="img" aria-label="Entstehung der Zeichnung" />
          {/* Pointer shortcut only; keyboard and screen readers use the player button below. */}
          <button type="button" className={`animation__overlay${playing ? ' is-playing' : ''}`} tabIndex={-1} aria-hidden="true" onClick={toggle}>
            <span className="animation__overlay-icon">
              <Icon name={status === 'finished' ? 'replay' : 'play'} size={28} />
            </span>
          </button>
        </div>
      </div>

      <div className="player" data-testid="player">
        <button type="button" className="player__button player__button--main" aria-label={playing ? 'Pause' : 'Abspielen'} onClick={toggle}>
          <Icon name={playing ? 'pause' : 'play'} size={20} />
        </button>
        <div className="player__track" role="progressbar" aria-label="Fortschritt" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <div ref={barRef} className="player__bar" />
          <div className="player__hold" style={{ left: `${(durationMs / position.total) * 100}%` }} aria-hidden="true" />
        </div>
        <span className="player__time">
          {formatTime(position.elapsed)} / {formatTime(position.total)}
        </span>
        <button type="button" className="player__button" aria-label="Von vorn" onClick={() => loopRef.current?.replay()}>
          <Icon name="replay" size={18} />
        </button>
      </div>

      {showDebug && debug && (
        <dl className="debug__metrics animation__debug" data-testid="animation-metrics">
          <dt>Animation</dt>
          <dd>
            Dauer {formatTime(durationMs)} · Fortschritt {(debug.progress * 100).toFixed(1)} % · sichtbar {Math.round(debug.visible)} / {Math.round(debug.total)} px
          </dd>
          <dt>Frames</dt>
          <dd>
            {debug.stats.frameCount} · {debug.stats.fps.toFixed(0)} fps · {debug.stats.droppedFrames} ausgelassen · Render {debug.stats.lastRenderMs.toFixed(1)} ms (Ø {debug.stats.averageRenderMs.toFixed(1)} ms)
          </dd>
        </dl>
      )}

      <footer className="controlbar">
        <div className="controlbar__options">
          <DurationChoice durationMs={durationMs} onChange={onDurationChange} fill />
          <DisplayChoice render={render} fill />
        </div>
        <div className="controlbar__nav">
          <Button variant="quiet" onClick={onBack}>
            <Icon name="arrowLeft" size={18} />
            Zurück
          </Button>
          <Button onClick={onContinue}>
            Weiter
            <Icon name="arrowRight" size={18} />
          </Button>
        </div>
      </footer>
    </section>
  );
}
