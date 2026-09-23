import { useState, type DragEvent } from 'react';
import { Button } from './Button';

interface ImportAreaProps {
  onChooseFile: () => void;
  /** Present only where the device can take a photo directly. */
  onTakePhoto?: (() => void) | undefined;
  onDropFile: (file: File) => void;
}

/** Calm, large empty state. Also accepts a dropped file on desktop. */
export function ImportArea({ onChooseFile, onTakePhoto, onDropFile }: ImportAreaProps) {
  const [dragging, setDragging] = useState(false);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onDropFile(file);
  };

  return (
    <div
      className={`import-area${dragging ? ' is-dragging' : ''}`}
      data-testid="import-area"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <svg className="import-area__mark" viewBox="0 0 120 60" aria-hidden="true">
        <path d="M4 44c14-2 18-30 32-30s10 30 24 30 12-34 26-34 16 26 30 22" />
      </svg>
      <p className="import-area__title">Ein Foto. Eine Linie.</p>
      <div className="import-area__actions">
        <Button onClick={onChooseFile}>{onTakePhoto ? 'Foto auswählen' : 'Bild auswählen'}</Button>
        {onTakePhoto && (
          <Button variant="quiet" onClick={onTakePhoto}>
            Foto aufnehmen
          </Button>
        )}
      </div>
      <p className="import-area__hint">JPG, PNG oder HEIC{onTakePhoto ? '' : ' · oder hierher ziehen'}</p>
    </div>
  );
}
