import { useMemo, type DragEvent } from 'react';
import { supportsCameraCapture } from '../../platform/browser/capabilities';
import { Button } from '../../ui/components/Button';
import { ImageViewer } from '../../ui/components/ImageViewer';
import { ImportArea } from '../../ui/components/ImportArea';
import { StatusPanel } from '../../ui/components/StatusPanel';
import { isAnalysisDebugEnabled } from '../../platform/browser/debugFlags';
import { AnalysisDebugView } from '../debug/AnalysisDebugView';
import { ANALYSIS_ERROR_MESSAGES, FORMAT_LABELS, IMPORT_ERROR_MESSAGES } from '../importMessages';
import { useFilePicker } from '../state/useFilePicker';
import type { ImageImportController } from '../state/useImageImport';

interface ImportScreenProps {
  controller: ImageImportController;
  /** Proceed to the drawing settings (enabled once the image is analysed). */
  onContinue: () => void;
}

/** Step 1: choose a photo, inspect it, replace or remove it. */
export function ImportScreen({ controller, onContinue }: ImportScreenProps) {
  const { state, selectFile, removeImage, retryAnalysis } = controller;
  const picker = useFilePicker(selectFile);
  const canTakePhoto = useMemo(() => supportsCameraCapture(), []);
  const debugAnalysis = useMemo(() => isAnalysisDebugEnabled(), []);

  const dropToReplace = {
    onDragOver: (e: DragEvent) => e.preventDefault(),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      selectFile(e.dataTransfer.files[0] ?? null);
    },
  };

  return (
    <section className="import" data-testid="import-screen" data-status={state.status}>
      {picker.inputs}

      {state.status === 'empty' && (
        <ImportArea onChooseFile={picker.chooseFile} onTakePhoto={canTakePhoto ? picker.takePhoto : undefined} onDropFile={selectFile} />
      )}

      {state.status === 'loading' && <StatusPanel busy title="Bild wird geladen" />}
      {state.status === 'processing' && <StatusPanel busy title="Bild wird vorbereitet" />}

      {state.status === 'error' && (
        <StatusPanel title={IMPORT_ERROR_MESSAGES[state.error].title} detail={IMPORT_ERROR_MESSAGES[state.error].detail}>
          <Button onClick={picker.chooseFile}>Anderes Bild wählen</Button>
          <Button variant="quiet" onClick={removeImage}>
            Abbrechen
          </Button>
        </StatusPanel>
      )}

      {state.status === 'ready' && (
        <>
          <div className="import__stage" {...dropToReplace}>
            {debugAnalysis ? (
              <AnalysisDebugView key={state.session.original.id} session={state.session} controller={controller} />
            ) : (
              <ImageViewer key={state.session.original.id} image={state.session.preview} label={state.session.original.fileName} />
            )}
          </div>
          <footer
            className="toolbar"
            data-testid="image-toolbar"
            data-image-size={`${state.session.original.metadata.width}x${state.session.original.metadata.height}`}
            data-processing-size={`${state.session.processed.pixels.width}x${state.session.processed.pixels.height}`}
            data-orientation={state.session.original.metadata.orientation}
            data-image-id={state.session.original.id}
            data-analysis-status={state.session.analysisStatus}
          >
            <p className="toolbar__meta">
              {state.session.original.metadata.width} × {state.session.original.metadata.height} ·{' '}
              {FORMAT_LABELS[state.session.original.metadata.format]}
              {(state.session.analysisStatus === 'pending' || state.session.analysisStatus === 'running') && (
                <span className="toolbar__status" role="status">
                  {' '}
                  · Bild wird analysiert
                </span>
              )}
            </p>
            {state.session.analysisStatus === 'failed' && state.session.analysisError && (
              <p className="toolbar__notice" role="alert">
                {ANALYSIS_ERROR_MESSAGES[state.session.analysisError].title}.{' '}
                <button type="button" className="toolbar__link" onClick={retryAnalysis}>
                  Erneut versuchen
                </button>
              </p>
            )}
            <div className="toolbar__actions">
              <Button variant="quiet" onClick={picker.chooseFile}>
                Anderes Bild
              </Button>
              <Button variant="quiet" onClick={removeImage}>
                Bild entfernen
              </Button>
              <Button
                disabled={state.session.analysisStatus !== 'ready'}
                title={state.session.analysisStatus === 'ready' ? undefined : 'Das Bild wird noch analysiert'}
                onClick={onContinue}
              >
                Weiter
              </Button>
            </div>
          </footer>
        </>
      )}
    </section>
  );
}
