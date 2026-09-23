import { useEffect, useState } from 'react';
import { DETAIL_LEVELS, type ImageSession, type OneLinePath } from '../../core';
import { Button } from '../../ui/components/Button';
import { ImageViewer } from '../../ui/components/ImageViewer';
import { SegmentedControl } from '../../ui/components/SegmentedControl';
import { StatusPanel } from '../../ui/components/StatusPanel';
import { DETAIL_LEVEL_LABELS, DISPLAY_OPTIONS, PATH_ERROR_MESSAGES } from '../drawingLabels';
import { ANALYSIS_ERROR_MESSAGES } from '../importMessages';
import { PREVIEW_RENDER_EDGE } from '../preview/previewConfig';
import { useArtwork } from '../preview/useArtwork';
import type { ImageImportController } from '../state/useImageImport';
import type { RenderSettingsController } from '../state/useRenderSettings';

const DETAIL_OPTIONS = DETAIL_LEVELS.map((value) => ({ value, ...DETAIL_LEVEL_LABELS[value] }));

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
  const { renderSettings, updateRenderSettings } = render;
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
  const { artwork } = useArtwork({ path: shown, settings: renderSettings, longEdge: PREVIEW_RENDER_EDGE, image: session.processed.pixels, backgroundImage: session.preview });
  const bitmap = artwork?.image ?? null;
  const display = DISPLAY_OPTIONS.find((o) => o.colorMode === renderSettings.colorMode)?.value ?? 'black';

  const busy = pathStatus === 'running' || (pathStatus === 'idle' && analysisStatus === 'ready');
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
          <ImageViewer key={session.original.id} image={bitmap} label="One-Line-Zeichnung" />
        ) : (
          <StatusPanel busy title={analysisStatus === 'ready' ? 'Zeichnung wird berechnet' : 'Bild wird analysiert'} />
        )}
        {busy && bitmap && (
          <p className="settings__busy" role="status">
            Zeichnung wird berechnet …
          </p>
        )}
      </div>
      <footer className="toolbar toolbar--settings">
        <Button variant="quiet" onClick={onBack}>
          Zurück
        </Button>
        <div className="settings__controls">
          <SegmentedControl label="Detailgrad" options={DETAIL_OPTIONS} value={level} onChange={(detailLevel) => setDrawing({ detailLevel })} />
          <SegmentedControl
            label="Darstellung"
            options={DISPLAY_OPTIONS}
            value={display}
            onChange={(value) => updateRenderSettings({ colorMode: DISPLAY_OPTIONS.find((o) => o.value === value)!.colorMode })}
          />
        </div>
        <Button disabled={pathStatus !== 'ready'} onClick={onContinue}>
          Weiter
        </Button>
      </footer>
    </section>
  );
}
