import { useEffect, useMemo, useRef, useState } from 'react';
import { DURATION_PRESETS_MS, type ImageSession, type PlaybackStatus } from '../../core';
import { createAnimationLoop, type AnimationLoop, type AnimationStats } from '../../platform/browser/animation/animationLoop';
import { createArtworkAnimator } from '../../platform/browser/animation/artworkAnimator';
import { isAnalysisDebugEnabled } from '../../platform/browser/debugFlags';
import { Button } from '../../ui/components/Button';
import { SegmentedControl } from '../../ui/components/SegmentedControl';
import { DISPLAY_OPTIONS } from '../drawingLabels';
import { PREVIEW_RENDER_EDGE } from '../preview/previewConfig';
import type { RenderSettingsController } from '../state/useRenderSettings';

interface AnimationScreenProps {
  session: ImageSession<ImageBitmap>;
  render: RenderSettingsController;
  durationMs: number;
  onDurationChange: (durationMs: number) => void;
  onBack: () => void;
}

const DURATION_OPTIONS = DURATION_PRESETS_MS.map((ms) => ({ value: String(ms), label: `${ms / 1000} s` }));
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
 */
export function AnimationScreen({ session, render, durationMs, onDurationChange, onBack }: AnimationScreenProps) {
  const { path } = session;
  const { renderSettings, updateRenderSettings } = render;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const loopRef = useRef<AnimationLoop | null>(null);
  const [status, setStatus] = useState<PlaybackStatus>('ready');
  const [elapsed, setElapsed] = useState(0);
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
        if (barRef.current) barRef.current.style.transform = `scaleX(${state.progress})`;
        canvas.dataset.progress = state.progress.toFixed(4);
        canvas.dataset.status = state.status;
        const now = performance.now();
        if (now - lastUi > 100 || state.status !== 'playing') {
          lastUi = now;
          setStatus(state.status);
          setElapsed(state.progress * state.durationMs);
          if (showDebug) setDebug({ progress: state.progress, visible: frame.visibleLength, total: animator.index.totalLength, stats });
        }
      },
      previous?.progress ?? 0,
    );
    loopRef.current = loop;
    if (previous?.status === 'playing') loop.play();
    return () => loop.dispose();
  }, [path, renderSettings, durationMs, session.processed.pixels, session.preview, showDebug]);

  const display = DISPLAY_OPTIONS.find((o) => o.colorMode === renderSettings.colorMode)?.value ?? 'black';
  const playing = status === 'playing';

  return (
    <section className="animation" data-testid="animation-screen" data-status={status}>
      <div className="animation__stage">
        <canvas
          ref={canvasRef}
          className="animation__canvas"
          data-testid="animation-canvas"
          role="img"
          aria-label="Entstehung der Zeichnung"
          style={size ? { aspectRatio: `${size.width} / ${size.height}` } : undefined}
        />
      </div>
      <div className="player" data-testid="player">
        <button
          type="button"
          className="player__button"
          aria-label={playing ? 'Pause' : 'Abspielen'}
          onClick={() => (playing ? loopRef.current?.pause() : loopRef.current?.play())}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="player__track" role="progressbar" aria-label="Fortschritt" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((elapsed / durationMs) * 100)}>
          <div ref={barRef} className="player__bar" />
        </div>
        <span className="player__time">
          {formatTime(elapsed)} / {formatTime(durationMs)}
        </span>
        <button type="button" className="player__button" aria-label="Von vorn" onClick={() => loopRef.current?.replay()}>
          ↻
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
      <footer className="toolbar toolbar--settings">
        <Button variant="quiet" onClick={onBack}>
          Zurück
        </Button>
        <div className="settings__controls">
          <SegmentedControl label="Dauer" options={DURATION_OPTIONS} value={String(durationMs)} onChange={(value) => onDurationChange(Number(value))} />
          <SegmentedControl
            label="Darstellung"
            options={DISPLAY_OPTIONS}
            value={display}
            onChange={(value) => updateRenderSettings({ colorMode: DISPLAY_OPTIONS.find((o) => o.value === value)!.colorMode })}
          />
        </div>
        <Button disabled title="Folgt in einem späteren Schritt">
          Weiter
        </Button>
      </footer>
    </section>
  );
}
