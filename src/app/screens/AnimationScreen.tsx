import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import {
  createPathProgress,
  drawingDurationMs,
  isHolding,
  nearestPathPoint,
  playbackTotalMs,
  toPathPoint,
  type ImageSession,
  type PlaybackStatus,
} from '../../core';
import { createAnimationLoop, type AnimationLoop, type AnimationStats } from '../../platform/browser/animation/animationLoop';
import { createArtworkAnimator } from '../../platform/browser/animation/artworkAnimator';
import { isAnalysisDebugEnabled } from '../../platform/browser/debugFlags';
import { Button } from '../../ui/components/Button';
import { Icon } from '../../ui/components/Icon';
import { DisplayChoice, DurationChoice } from '../controls';
import { PlaybackPanel } from '../PlaybackPanel';
import type { AnimationChoice } from '../state/useProjects';
import { PREVIEW_RENDER_EDGE } from '../preview/previewConfig';
import type { RenderSettingsController } from '../state/useRenderSettings';

interface AnimationScreenProps {
  session: ImageSession<ImageBitmap>;
  render: RenderSettingsController;
  animation: Required<AnimationChoice>;
  onAnimationChange: (patch: Partial<AnimationChoice>) => void;
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
export function AnimationScreen({ session, render, animation, onAnimationChange, onBack, onContinue }: AnimationScreenProps) {
  const { path } = session;
  // The line is drawn in duration ÷ speed; the final hold comes on top.
  const durationMs = drawingDurationMs(animation);
  const { direction, startPoint } = animation;
  const [panelOpen, setPanelOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const panelId = useId();
  // Where the drawing really starts: the path point nearest to the chosen image point.
  const start = useMemo(() => (path && startPoint ? nearestPathPoint(createPathProgress(path), toPathPoint(path, startPoint)) : null), [path, startPoint]);
  const photoRef = useRef<HTMLCanvasElement>(null);
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
      direction,
      startPoint,
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
  }, [path, renderSettings, durationMs, direction, startPoint, session.processed.pixels, session.preview, showDebug]);

  // App/tab in the background: pause instead of letting the timeline run out unseen (resume stays manual).
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && loopRef.current?.state().status === 'playing') loopRef.current.pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // While choosing the start point the (edited) photo is shown, so e.g. an eye can be tapped.
  useEffect(() => {
    const canvas = photoRef.current;
    const ctx = canvas?.getContext('2d');
    if (!picking || !canvas || !ctx || !size) return;
    canvas.width = size.width;
    canvas.height = size.height;
    ctx.drawImage(session.preview, 0, 0, size.width, size.height);
  }, [picking, size, session.preview]);

  /** Tap on the image → normalized point of the edited image (independent of the screen size). */
  const pick = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const point = { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
    setPicking(false);
    loopRef.current?.seek(0);
    onAnimationChange({ startPoint: { x: Math.min(1, Math.max(0, point.x)), y: Math.min(1, Math.max(0, point.y)) } });
  };

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
          <div className="animation__paper">
            <canvas
              ref={canvasRef}
              className="animation__canvas"
              data-testid="animation-canvas"
              data-direction={direction}
              data-start={start && path ? `${(start.point.x / path.bounds.width).toFixed(4)},${(start.point.y / path.bounds.height).toFixed(4)}` : 'auto'}
              role="img"
              aria-label="Entstehung der Zeichnung"
            />
            {/* UI only: never part of the rendered frames, images or videos. */}
            {start && path && !picking && (
              <span
                className="animation__start"
                data-testid="start-marker"
                style={{ left: `${(start.point.x / path.bounds.width) * 100}%`, top: `${(start.point.y / path.bounds.height) * 100}%` }}
                aria-hidden="true"
              />
            )}
            {picking && (
              <button type="button" className="animation__pick" data-testid="start-picker" aria-label="Startpunkt auf dem Bild wählen" onPointerUp={pick}>
                <canvas ref={photoRef} className="animation__photo" aria-hidden="true" />
                <span className="animation__pick-hint">Tippe auf die Stelle, an der die Linie beginnen soll</span>
              </button>
            )}
          </div>
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

      {panelOpen && (
        <PlaybackPanel
          id={panelId}
          animation={animation}
          onChange={onAnimationChange}
          picking={picking}
          onPick={() => setPicking((p) => !p)}
          startDistance={start?.distance ?? null}
        />
      )}
      <footer className="controlbar controlbar--wide">
        <div className="controlbar__options">
          <DurationChoice durationMs={animation.durationMs} speed={animation.speed} onChange={(ms) => onAnimationChange({ durationMs: ms })} fill />
          <DisplayChoice render={render} fill />
        </div>
        <div className="controlbar__nav">
          <div className="controlbar__start">
            <Button variant="quiet" onClick={onBack}>
              <Icon name="arrowLeft" size={18} />
              <span className="controlbar__collapsible">Zurück</span>
            </Button>
            <Button variant="ghost" aria-expanded={panelOpen} aria-controls={panelOpen ? panelId : undefined} onClick={() => setPanelOpen((o) => !o)}>
              <Icon name="sliders" size={18} />
              Wiedergabe
            </Button>
          </div>
          <Button onClick={onContinue}>
            Weiter
            <Icon name="arrowRight" size={18} />
          </Button>
        </div>
      </footer>
    </section>
  );
}
