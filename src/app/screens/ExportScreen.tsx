import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  IDLE_EXPORT_STATE,
  UI_VIDEO_FPS,
  exportErrorCode,
  exportReducer,
  imageExportSize,
  isExportRunning,
  timelineDurationMs,
  drawingDurationMs,
  videoFrameSize,
  type ExportFile,
  type ExportKind,
  type ExportState,
  type ImageExportFormat,
  type ImageResolution,
  type ImageSession,
  type VideoCapability,
  type VideoResolution,
  editedSize,
} from '../../core';
import type { BrowserExportSource } from '../../platform/browser/export/imageExporter';
import { exportFileActions } from '../../platform/fileActions';
import { Button } from '../../ui/components/Button';
import { useBackHandler } from '../../ui/useBackHandler';
import { SegmentedControl } from '../../ui/components/SegmentedControl';
import { Icon } from '../../ui/components/Icon';
import { ImageViewer } from '../../ui/components/ImageViewer';
import { OptionGroup } from '../../ui/components/OptionGroup';
import { DisplayChoice, DurationChoice, seconds } from '../controls';
import type { AnimationChoice } from '../state/useProjects';
import { useZoomResolution } from '../preview/useZoomResolution';
import { useArtwork } from '../preview/useArtwork';
import { EXPORT_ERROR_MESSAGES } from '../exportMessages';
import type { RenderSettingsController } from '../state/useRenderSettings';

interface ExportScreenProps {
  session: ImageSession<ImageBitmap>;
  render: RenderSettingsController;
  animation: Required<AnimationChoice>;
  onAnimationChange: (patch: Partial<AnimationChoice>) => void;
  projectName: string | null;
  /** The current work as a portable project file (13.6). */
  onProjectFile: () => Promise<ExportFile<Blob>>;
  onBack: () => void;
}

const FORMAT_OPTIONS: { value: ImageExportFormat; label: string }[] = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
];
const IMAGE_RES_OPTIONS: { value: ImageResolution; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: '2048', label: '2048 px' },
  { value: '4096', label: '4096 px' },
];
const VIDEO_RES_OPTIONS: { value: VideoResolution; label: string }[] = [
  { value: '1080p', label: '1080p' },
  { value: '2048', label: '2048 px' },
  { value: '4096', label: '4096 px' },
];
const VIDEO_FPS = UI_VIDEO_FPS[0]!;

const formatBytes = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Lazy: the video encoder (and its muxer) is only loaded when needed. */
const loadVideoModule = () => Promise.all([import('../../platform/browser/export/videoExporter'), import('../../platform/browser/export/webCodecsEncoder')]);

/**
 * Step 4: export the finished artwork as image or creation video. Both are
 * rendered anew from the SAME path and settings as preview and animation.
 */
export function ExportScreen({ session, render, animation, onAnimationChange, projectName, onProjectFile, onBack }: ExportScreenProps) {
  // The video shows the same drawing process as the preview: drawing time, direction, start point.
  const durationMs = drawingDurationMs(animation);
  const { renderSettings } = render;
  const path = session.path;
  const [format, setFormat] = useState<ImageExportFormat>('png');
  const [imageRes, setImageRes] = useState<ImageResolution>('4096');
  const [videoRes, setVideoRes] = useState<VideoResolution>('1080p');
  const [state, dispatch] = useReducer(exportReducer<Blob>, IDLE_EXPORT_STATE as ExportState<Blob>);
  const job = useRef<{ id: number; abort: AbortController } | null>(null);
  const [probed, setProbed] = useState<{ readonly key: string; readonly capability: VideoCapability } | null>(null);

  // "Original" = the edited image at the original's resolution (crop in original pixels).
  const originalSize = useMemo(() => editedSize(session.original.metadata, session.edit), [session.original, session.edit]);
  const imageSize = useMemo(() => (path ? imageExportSize(path.bounds, originalSize, imageRes) : null), [path, originalSize, imageRes]);
  const videoSize = useMemo(() => (path ? videoFrameSize(path.bounds, videoRes) : null), [path, videoRes]);

  // Ask the device once per size whether it can encode video (no guessing of codecs).
  const sizeKey = videoSize ? `${videoSize.size.width}x${videoSize.size.height}` : '';
  const capability = probed?.key === sizeKey ? probed.capability : null;
  useEffect(() => {
    if (!videoSize) return;
    let alive = true;
    const key = `${videoSize.size.width}x${videoSize.size.height}`;
    loadVideoModule()
      .then(([, { webCodecsEncoder }]) => webCodecsEncoder.probe(videoSize.size, VIDEO_FPS))
      .then((c) => alive && setProbed({ key, capability: c }))
      .catch((error: unknown) => {
        console.error('Video capability check failed', error);
        if (alive) setProbed({ key, capability: { supported: false, reason: 'encoder-unavailable' } });
      });
    return () => {
      alive = false;
    };
  }, [videoSize]);

  // Leaving the screen cancels a running export.
  useEffect(() => () => job.current?.abort.abort(), []);

  const source = (): BrowserExportSource | null =>
    path ? { path, render: renderSettings, image: session.processed.pixels, backgroundImage: session.preview, originalSize, projectName } : null;

  const start = async (kind: ExportKind) => {
    const src = source();
    if (!src || isExportRunning(state)) return;
    const id = (job.current?.id ?? state.jobId) + 1;
    const abort = new AbortController();
    job.current = { id, abort };
    dispatch({ type: 'started', jobId: id, kind });
    const onPhase = (phase: 'preparing' | 'rendering' | 'encoding') => dispatch({ type: 'phase', jobId: id, phase });
    const onProgress = (progress: number) => dispatch({ type: 'progress', jobId: id, progress });
    try {
      let file: ExportFile<Blob>;
      if (kind === 'image') {
        const { exportArtworkImage } = await import('../../platform/browser/export/imageExporter');
        file = await exportArtworkImage({ source: src, settings: { format, resolution: imageRes }, signal: abort.signal, onPhase });
      } else {
        const [{ exportCreationVideo }] = await loadVideoModule();
        file = await exportCreationVideo({
          source: src,
          settings: { resolution: videoRes, fps: VIDEO_FPS, durationMs },
          direction: animation.direction,
          startPoint: animation.startPoint,
          signal: abort.signal,
          onPhase,
          onProgress,
        });
      }
      dispatch({ type: 'succeeded', jobId: id, file: { fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, data: file.data } });
    } catch (error) {
      const code = abort.signal.aborted ? 'cancelled' : exportErrorCode(error);
      if (code !== 'cancelled') console.error(`${kind} export failed`, error);
      dispatch({ type: 'failed', jobId: id, error: code });
    }
  };

  const cancel = () => {
    if (!job.current) return;
    job.current.abort.abort();
    dispatch({ type: 'cancelled', jobId: job.current.id });
  };

  const running = isExportRunning(state);
  // Android back button while exporting: stop the export (stays on this screen).
  useBackHandler(running, cancel);
  const videoBlocked = capability !== null && !capability.supported;
  const percent = Math.round(state.progress * 100);
  const totalVideoMs = timelineDurationMs(durationMs);
  // Static artwork (same renderer as everywhere) as the visual anchor of the screen.
  const zoom = useZoomResolution(path);
  const { artwork } = useArtwork({ path, settings: renderSettings, longEdge: zoom.longEdge, image: session.processed.pixels, backgroundImage: session.preview });

  // Short announcement for screen readers (the visual status sits below the section that started the export).
  const liveText =
    state.status === 'ready' ? 'Export fertig' : state.status === 'failed' ? 'Export fehlgeschlagen' : state.status === 'cancelled' ? 'Export abgebrochen' : running ? 'Export läuft' : '';
  const statusBlock = state.kind && state.status !== 'idle' && (
    <div className={`export__status is-${state.status}`} data-testid="export-status">
      {running && (
        <div className="export__progress" role="status">
          <p className="export__status-title">
            {state.status === 'preparing'
              ? 'Export wird vorbereitet …'
              : state.kind === 'video'
                ? `Video wird erstellt … ${percent} %`
                : state.status === 'rendering'
                  ? 'Bild wird erstellt …'
                  : 'Datei wird fertiggestellt …'}
          </p>
          <div
            className={`progress${state.kind === 'video' ? '' : ' progress--indeterminate'}`}
            role="progressbar"
            aria-label="Exportfortschritt"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={state.kind === 'video' ? percent : undefined}
          >
            <div className="progress__bar" style={state.kind === 'video' ? { transform: `scaleX(${state.progress})` } : undefined} />
          </div>
          <Button variant="quiet" onClick={cancel}>
            Abbrechen
          </Button>
        </div>
      )}
      {state.status === 'ready' && state.file && <ExportReady file={state.file} />}
      {state.status === 'cancelled' && (
        <p className="notice">
          <span>
            <strong>{EXPORT_ERROR_MESSAGES.cancelled.title}.</strong> {EXPORT_ERROR_MESSAGES.cancelled.detail}
          </span>
        </p>
      )}
      {state.status === 'failed' && (
        <div className="notice notice--error" role="alert">
          <Icon name="alert" size={18} />
          <span>
            <strong>{EXPORT_ERROR_MESSAGES[state.error ?? 'encoding-failed'].title}.</strong> {EXPORT_ERROR_MESSAGES[state.error ?? 'encoding-failed'].detail}
          </span>
          {state.kind && (
            <Button variant="quiet" onClick={() => void start(state.kind!)}>
              Erneut versuchen
            </Button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <section className="export" data-testid="export-screen" data-export-status={state.status} data-export-kind={state.kind ?? ''}>
      <div className="export__preview">{artwork && <ImageViewer key={session.original.id} image={artwork.image} label="One-Line-Zeichnung" onScaleChange={zoom.onScaleChange} />}</div>

      <div className="export__panel">
        <fieldset className="export__section" disabled={running}>
          <legend className="export__title">Bild</legend>
          <OptionGroup label="Format" caption={format === 'png' ? 'Verlustfrei, beste Qualität' : 'Kleinere Datei'}>
            <SegmentedControl label="Format" options={FORMAT_OPTIONS} value={format} onChange={(v) => setFormat(v as ImageExportFormat)} fill />
          </OptionGroup>
          <OptionGroup label="Größe">
            <SegmentedControl label="Auflösung" options={IMAGE_RES_OPTIONS} value={imageRes} onChange={(v) => setImageRes(v as ImageResolution)} fill />
          </OptionGroup>
          <p className="export__info">
            <span data-testid="image-export-size">{imageSize ? `${imageSize.size.width} × ${imageSize.size.height} px` : '–'}</span>
            {imageSize?.limited && <span> · auf die größtmögliche Größe begrenzt</span>}
          </p>
          <Button className="export__action" onClick={() => void start('image')} disabled={!path || running}>
            <Icon name="download" size={18} />
            Bild exportieren
          </Button>
        </fieldset>
        {state.kind === 'image' && statusBlock}

        <fieldset className="export__section" disabled={running}>
          <legend className="export__title">Video</legend>
          <DurationChoice durationMs={animation.durationMs} speed={animation.speed} onChange={(ms) => onAnimationChange({ durationMs: ms })} fill />
          <OptionGroup label="Auflösung">
            <SegmentedControl label="Auflösung" options={VIDEO_RES_OPTIONS} value={videoRes} onChange={(v) => setVideoRes(v as VideoResolution)} fill />
          </OptionGroup>
          <DisplayChoice render={render} fill />
          <p className="export__info">
            {capability?.supported && <span>{capability.extension.toUpperCase()} · </span>}
            <span data-testid="video-export-size">{videoSize ? `${videoSize.size.width} × ${videoSize.size.height} px · ${VIDEO_FPS} fps · ${seconds(totalVideoMs)}` : '–'}</span>
          </p>
          {videoBlocked && (
            <p className="notice notice--warning" role="note" data-testid="video-unsupported">
              <Icon name="alert" size={18} />
              <span>
                <strong>{EXPORT_ERROR_MESSAGES[capability.reason].title}.</strong> {EXPORT_ERROR_MESSAGES[capability.reason].detail}
              </span>
            </p>
          )}
          <Button className="export__action" onClick={() => void start('video')} disabled={!path || running || videoBlocked || capability === null}>
            <Icon name="download" size={18} />
            Video exportieren
          </Button>
        </fieldset>
        {state.kind === 'video' && statusBlock}

        <ProjectFileSection create={onProjectFile} disabled={running || !path} />
        <p className="sr-only" aria-live="polite">
          {liveText}
        </p>

        <div className="controlbar__nav export__nav">
          <Button variant="quiet" onClick={onBack} disabled={running}>
            <Icon name="arrowLeft" size={18} />
            Zurück
          </Button>
        </div>
      </div>
    </section>
  );
}

/**
 * "Projektdatei" (13.6): the current work — photo, drawing and every setting —
 * as one ".onelineart" file to keep or pass on; importable in "Meine Werke".
 */
function ProjectFileSection({ create, disabled }: { create: () => Promise<ExportFile<Blob>>; disabled: boolean }) {
  const [status, setStatus] = useState<'idle' | 'busy' | 'ready' | 'failed'>('idle');
  const [file, setFile] = useState<ExportFile<Blob> | null>(null);
  const run = async () => {
    setStatus('busy');
    setFile(null);
    try {
      setFile(await create());
      setStatus('ready');
    } catch (error) {
      console.error('Project file export failed', error);
      setStatus('failed');
    }
  };
  return (
    <>
      <fieldset className="export__section" disabled={disabled || status === 'busy'} data-testid="project-file-section" data-status={status}>
        <legend className="export__title">Projektdatei</legend>
        <p className="export__info">Foto, Zeichnung und alle Einstellungen in einer Datei – zum Sichern oder für ein anderes Gerät. In „Meine Werke“ wieder importierbar.</p>
        <Button className="export__action" variant="quiet" onClick={() => void run()}>
          <Icon name="download" size={18} />
          {status === 'busy' ? 'Wird erstellt …' : 'Projektdatei exportieren'}
        </Button>
      </fieldset>
      {status === 'ready' && file && (
        <div className="export__status is-ready">
          <ExportReady file={file} media={false} testId="project-file-ready" />
        </div>
      )}
      {status === 'failed' && (
        <div className="notice notice--error" role="alert">
          <Icon name="alert" size={18} />
          <span>
            <strong>Die Projektdatei konnte nicht erstellt werden.</strong> Bitte erneut versuchen.
          </span>
        </div>
      )}
    </>
  );
}

/** `media`: an image or video (may go into the device gallery); a project file is only downloaded or shared. */
function ExportReady({ file, media = true, testId = 'export-ready' }: { file: ExportFile<Blob>; media?: boolean; testId?: string }) {
  const actions = useMemo(() => exportFileActions(), []);
  const shareable = useMemo(() => actions.canShare(file), [actions, file]);
  const [saving, setSaving] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  const [location, setLocation] = useState<string | null>(null);
  const [shareFailed, setShareFailed] = useState(false);
  const gallery = actions.saveKind === 'gallery';
  // The device gallery takes images and videos only: other files are passed on via "Teilen" (e.g. "In Dateien speichern").
  const canSave = media || !gallery;

  const save = async () => {
    setSaving('busy');
    try {
      setLocation((await actions.save(file)).location);
      setSaving('done');
    } catch (error) {
      console.error('Saving the export failed', error);
      setSaving('failed');
    }
  };
  const share = async () => {
    setShareFailed(false);
    try {
      await actions.share(file);
    } catch (error) {
      console.error('Sharing failed', error);
      setShareFailed(true);
    }
  };

  return (
    <div className="export__ready" data-testid={testId} data-file-name={file.fileName} data-file-size={file.sizeBytes} data-mime-type={file.mimeType}>
      <p className="export__status-title">
        <span className="export__done-icon">
          <Icon name="check" size={16} />
        </span>
        <span>
          Fertig: {file.fileName} <span className="export__size">({formatBytes(file.sizeBytes)})</span>
        </span>
      </p>
      <div className="export__ready-actions">
        {canSave && (
          <Button onClick={() => void save()} disabled={saving === 'busy' || (gallery && saving === 'done')}>
            <Icon name={gallery && saving === 'done' ? 'check' : 'download'} size={18} />
            {gallery ? (saving === 'busy' ? 'Wird gespeichert …' : saving === 'done' ? 'Gespeichert' : 'In Galerie speichern') : 'Herunterladen'}
          </Button>
        )}
        {shareable && (
          <Button variant="quiet" onClick={() => void share()}>
            <Icon name="share" size={18} />
            Teilen
          </Button>
        )}
      </div>
      {gallery && saving === 'done' && (
        <p className="notice" role="status" data-testid="export-saved">
          <span>Gespeichert unter „{location ?? 'Galerie'}“ – in der Galerie-App sichtbar.</span>
        </p>
      )}
      {(saving === 'failed' || shareFailed) && (
        <p className="notice notice--error" role="alert">
          <Icon name="alert" size={18} />
          <span>
            <strong>{EXPORT_ERROR_MESSAGES['save-failed'].title}.</strong> {EXPORT_ERROR_MESSAGES['save-failed'].detail}
          </span>
        </p>
      )}
    </div>
  );
}
