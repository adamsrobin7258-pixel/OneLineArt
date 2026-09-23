import { useEffect, useState } from 'react';
import type { ImageSession, OneLinePath } from '../../core';
import { Button } from '../../ui/components/Button';
import { ImageViewer } from '../../ui/components/ImageViewer';
import { Icon } from '../../ui/components/Icon';
import { StatusPanel } from '../../ui/components/StatusPanel';
import { DetailChoice, DisplayChoice } from '../controls';
import { PATH_ERROR_MESSAGES } from '../drawingLabels';
import { ANALYSIS_ERROR_MESSAGES } from '../importMessages';
import { useZoomResolution } from '../preview/useZoomResolution';
import { useArtwork } from '../preview/useArtwork';
import type { ImageImportController } from '../state/useImageImport';
import type { RenderSettingsController } from '../state/useRenderSettings';

interface SettingsScreenProps {
  session: ImageSession<ImageBitmap>;
  controller: ImageImportController;
  render: RenderSettingsController;
  onBack: () => void;
  /** To the drawing-process preview (enabled once the drawing is ready). */
  onContinue: () => void;
}

/**
 * Step 2: choose the detail level and see the drawing. Changing the level
 * recomputes only the line (the image analysis is reused); the previous
 * drawing stays visible, dimmed, until the new one is ready.
 */
export function SettingsScreen({ session, controller, render, onBack, onContinue }: SettingsScreenProps) {
  const { renderSettings } = render;
  const { oneLine, path, pathStatus, analysisStatus } = session;
  const { generatePath, setDrawing, retryAnalysis } = controller;

  // Compute the drawing for the current configuration when needed.
  useEffect(() => {
    if (analysisStatus === 'ready' && pathStatus === 'idle') void generatePath();
  }, [oneLine.key, analysisStatus, pathStatus, generatePath]);

  // Keep showing the last drawing while a new one is computed.
  const [lastPath, setLastPath] = useState<OneLinePath | null>(path);
  if (path && path !== lastPath) setLastPath(path);
  const shown = path ?? lastPath;
  // The artwork is rendered from the path; black ↔ colour only re-draws it.
  const zoom = useZoomResolution(shown);
  const { artwork } = useArtwork({ path: shown, settings: renderSettings, longEdge: zoom.longEdge, image: session.processed.pixels, backgroundImage: session.preview });
  const bitmap = artwork?.image ?? null;
  // Waiting for a drawing: computing it, or (reopened project, new level) analysing the image first.
  const busy = pathStatus === 'running' || (pathStatus === 'idle' && analysisStatus !== 'failed');
  const busyText = analysisStatus === 'ready' ? 'Zeichnung wird berechnet …' : 'Bild wird analysiert …';
  const level = oneLine.drawing.detailLevel;

  return (
    <section
      className="settings"
      data-testid="settings-screen"
      data-path-status={pathStatus}
      data-detail-level={level}
      data-path-current={path ? 'true' : 'false'}
      data-color-mode={renderSettings.colorMode}
      data-render-size={artwork ? `${artwork.size.width}x${artwork.size.height}` : ''}
      data-rendered-mode={artwork?.metrics.renderColorMode ?? ''}
    >
      <div className={`settings__stage${busy && bitmap ? ' is-busy' : ''}`}>
        {analysisStatus === 'failed' && session.analysisError ? (
          <StatusPanel title={ANALYSIS_ERROR_MESSAGES[session.analysisError].title} detail={ANALYSIS_ERROR_MESSAGES[session.analysisError].detail}>
            <Button onClick={retryAnalysis}>Erneut versuchen</Button>
          </StatusPanel>
        ) : pathStatus === 'failed' && session.pathError ? (
          <StatusPanel title={PATH_ERROR_MESSAGES[session.pathError].title} detail={PATH_ERROR_MESSAGES[session.pathError].detail}>
            <Button onClick={() => void generatePath()}>Erneut versuchen</Button>
          </StatusPanel>
        ) : bitmap ? (
          <ImageViewer key={session.original.id} image={bitmap} label="One-Line-Zeichnung" onScaleChange={zoom.onScaleChange} />
        ) : (
          <StatusPanel busy title={busyText} detail="Das dauert meist nur wenige Sekunden." />
        )}
        {busy && bitmap && (
          <p className="settings__busy" role="status">
            <span className="spinner" aria-hidden="true" />
            {busyText}
          </p>
        )}
      </div>
      <footer className="controlbar">
        <div className="controlbar__options">
          <DetailChoice value={level} onChange={(detailLevel) => setDrawing({ detailLevel })} fill />
          <DisplayChoice render={render} fill />
        </div>
        <div className="controlbar__nav">
          <Button variant="quiet" onClick={onBack}>
            <Icon name="arrowLeft" size={18} />
            Zurück
          </Button>
          <Button disabled={pathStatus !== 'ready'} onClick={onContinue}>
            Weiter
            <Icon name="arrowRight" size={18} />
          </Button>
        </div>
      </footer>
    </section>
  );
}
