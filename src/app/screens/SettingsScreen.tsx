import { useEffect, useState } from 'react';
import { DETAIL_LEVELS, type ImageSession, type OneLinePath } from '../../core';
import { Button } from '../../ui/components/Button';
import { ImageViewer } from '../../ui/components/ImageViewer';
import { SegmentedControl } from '../../ui/components/SegmentedControl';
import { StatusPanel } from '../../ui/components/StatusPanel';
import { DETAIL_LEVEL_LABELS, PATH_ERROR_MESSAGES } from '../drawingLabels';
import { ANALYSIS_ERROR_MESSAGES } from '../importMessages';
import { usePathBitmap } from '../preview/usePathBitmap';
import type { ImageImportController } from '../state/useImageImport';

const BLANK = { kind: 'blank' } as const;
const DETAIL_OPTIONS = DETAIL_LEVELS.map((value) => ({ value, ...DETAIL_LEVEL_LABELS[value] }));

interface SettingsScreenProps {
  session: ImageSession<ImageBitmap>;
  controller: ImageImportController;
  onBack: () => void;
}

/**
 * Step 2: choose the detail level and see the drawing. Changing the level
 * recomputes only the line (the image analysis is reused); the previous
 * drawing stays visible, dimmed, until the new one is ready.
 */
export function SettingsScreen({ session, controller, onBack }: SettingsScreenProps) {
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
  const bitmap = usePathBitmap(shown, shown ? BLANK : null, shown ? keyOf(shown) : '');

  const busy = pathStatus === 'running' || (pathStatus === 'idle' && analysisStatus === 'ready');
  const level = oneLine.drawing.detailLevel;

  return (
    <section className="settings" data-testid="settings-screen" data-path-status={pathStatus} data-detail-level={level} data-path-current={path ? 'true' : 'false'}>
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
        <SegmentedControl label="Detailgrad" options={DETAIL_OPTIONS} value={level} onChange={(detailLevel) => setDrawing({ detailLevel })} />
        <Button disabled title="Folgt in einem späteren Schritt">
          Weiter
        </Button>
      </footer>
    </section>
  );
}

/** Identity of a path object for bitmap caching (paths are immutable). */
const pathIds = new WeakMap<OneLinePath, number>();
let nextPathId = 0;
function keyOf(path: OneLinePath): string {
  let id = pathIds.get(path);
  if (id === undefined) pathIds.set(path, (id = ++nextPathId));
  return `path-${id}`;
}
