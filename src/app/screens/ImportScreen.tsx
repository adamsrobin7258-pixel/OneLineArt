import { useMemo, type DragEvent } from 'react';
import { supportsCameraCapture } from '../../platform/browser/capabilities';
import { Button } from '../../ui/components/Button';
import { ImageViewer } from '../../ui/components/ImageViewer';
import { ImportArea } from '../../ui/components/ImportArea';
import { StatusPanel } from '../../ui/components/StatusPanel';
import { FORMAT_LABELS, IMPORT_ERROR_MESSAGES } from '../importMessages';
import { useFilePicker } from '../state/useFilePicker';
import { useImageImport } from '../state/useImageImport';

/** Step 1: choose a photo, inspect it, replace or remove it. */
export function ImportScreen() {
  const { state, selectFile, removeImage } = useImageImport();
  const picker = useFilePicker(selectFile);
  const canTakePhoto = useMemo(() => supportsCameraCapture(), []);

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
            <ImageViewer key={state.session.original.id} image={state.session.preview} label={state.session.original.fileName} />
          </div>
          <footer
            className="toolbar"
            data-testid="image-toolbar"
            data-image-size={`${state.session.original.metadata.width}x${state.session.original.metadata.height}`}
            data-processing-size={`${state.session.processed.pixels.width}x${state.session.processed.pixels.height}`}
            data-orientation={state.session.original.metadata.orientation}
          >
            <p className="toolbar__meta">
              {state.session.original.metadata.width} × {state.session.original.metadata.height} ·{' '}
              {FORMAT_LABELS[state.session.original.metadata.format]}
            </p>
            <div className="toolbar__actions">
              <Button variant="quiet" onClick={picker.chooseFile}>
                Anderes Bild
              </Button>
              <Button variant="quiet" onClick={removeImage}>
                Bild entfernen
              </Button>
              <Button disabled title="Einstellungen folgen in einem späteren Schritt">
                Weiter
              </Button>
            </div>
          </footer>
        </>
      )}
    </section>
  );
}
