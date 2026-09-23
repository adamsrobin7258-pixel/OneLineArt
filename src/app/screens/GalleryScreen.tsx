import { useEffect, useRef, useState } from 'react';
import { STORAGE_LIMITS, storageErrorCode, type ProjectSummary, type StorageErrorCode } from '../../core';
import { Button } from '../../ui/components/Button';
import { StatusPanel } from '../../ui/components/StatusPanel';
import { DETAIL_LEVEL_LABELS } from '../drawingLabels';
import { STORAGE_ERROR_MESSAGES } from '../exportMessages';
import type { ProjectsController } from '../state/useProjects';

interface GalleryScreenProps {
  projects: ProjectsController;
  /** Opens a stored project; rejects with a StorageError. */
  onOpen: (id: string) => Promise<void>;
  onCreate: () => void;
  onBack: (() => void) | null;
}

const DATE_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const formatDate = (iso: string) => (Number.isNaN(Date.parse(iso)) ? '' : DATE_FORMAT.format(new Date(iso)));

/** "Meine Werke": the locally stored projects. Only lists, opens, renames and deletes. */
export function GalleryScreen({ projects, onOpen, onCreate, onBack }: GalleryScreenProps) {
  const [items, setItems] = useState<readonly ProjectSummary[] | null>(null);
  const [error, setError] = useState<StorageErrorCode | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const { list } = projects;

  useEffect(() => {
    let alive = true;
    list().then(
      (loaded) => alive && setItems(loaded),
      (e: unknown) => {
        console.error('Loading the gallery failed', e);
        if (!alive) return;
        setError(storageErrorCode(e));
        setItems([]);
      },
    );
    return () => {
      alive = false;
    };
  }, [list, generation]);

  const run = async (id: string, action: () => Promise<void>, reload: boolean) => {
    setBusyId(id);
    setError(null);
    try {
      await action();
    } catch (e) {
      console.error('Gallery action failed', e);
      setError(storageErrorCode(e));
    } finally {
      setBusyId(null);
      if (reload) setGeneration((g) => g + 1);
    }
  };

  return (
    <section className="gallery" data-testid="gallery-screen" data-count={items?.length ?? ''}>
      <header className="gallery__header">
        <h2>Meine Werke</h2>
        {onBack && (
          <Button variant="quiet" onClick={onBack}>
            Zurück
          </Button>
        )}
      </header>
      {error && (
        <p className="export__notice" role="alert" data-testid="gallery-error">
          {STORAGE_ERROR_MESSAGES[error].title}. {STORAGE_ERROR_MESSAGES[error].detail}
        </p>
      )}
      {items === null ? (
        <StatusPanel busy title="Werke werden geladen" />
      ) : items.length === 0 ? (
        <StatusPanel title="Noch keine Werke">
          <Button onClick={onCreate}>Erstes Werk erstellen</Button>
        </StatusPanel>
      ) : (
        <ul className="gallery__grid">
          {items.map((item) => (
            <GalleryCard
              key={item.id}
              item={item}
              busy={busyId === item.id}
              onOpen={() => void run(item.id, () => onOpen(item.id), false)}
              onRename={(name) => void run(item.id, () => projects.rename(item.id, name), true)}
              onDelete={() => void run(item.id, () => projects.remove(item.id), true)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function GalleryCard({ item, busy, onOpen, onRename, onDelete }: { item: ProjectSummary; busy: boolean; onOpen: () => void; onRename: (name: string) => void; onDelete: () => void }) {
  const img = useRef<HTMLImageElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const thumbnail = item.thumbnail;

  // The object URL lives exactly as long as the card shows this thumbnail.
  useEffect(() => {
    if (!thumbnail || !img.current) return;
    const objectUrl = URL.createObjectURL(thumbnail.data as Blob);
    img.current.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [thumbnail]);

  const ok = item.status === 'ok';
  const title = item.name || formatDate(item.createdAt) || 'Unbenanntes Werk';
  return (
    <li className="gallery__card" data-testid="gallery-item" data-project-id={item.id} data-status={item.status}>
      <button type="button" className="gallery__open" onClick={onOpen} disabled={!ok || busy} aria-label={`${title} öffnen`}>
        {thumbnail ? <img ref={img} width={thumbnail.width} height={thumbnail.height} alt="" /> : <span className="gallery__placeholder">{ok ? '' : 'Beschädigt'}</span>}
      </button>
      <div className="gallery__meta">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setEditing(false);
              onRename(name);
            }}
          >
            <input aria-label="Name" value={name} maxLength={STORAGE_LIMITS.maxNameLength} onChange={(e) => setName(e.target.value)} autoFocus />
            <Button type="submit">OK</Button>
          </form>
        ) : (
          <p className="gallery__title">{title}</p>
        )}
        <p className="gallery__detail">
          {ok ? `${formatDate(item.updatedAt)} · ${item.detailLevel ? DETAIL_LEVEL_LABELS[item.detailLevel].label : ''}` : item.status === 'incompatible' ? 'Andere App-Version' : 'Kann nicht geöffnet werden'}
        </p>
        {confirming ? (
          <div className="gallery__confirm" role="group" aria-label="Löschen bestätigen">
            <span>Werk wirklich löschen?</span>
            <Button onClick={onDelete} disabled={busy}>
              Endgültig löschen
            </Button>
            <Button variant="quiet" onClick={() => setConfirming(false)}>
              Abbrechen
            </Button>
          </div>
        ) : (
          <div className="gallery__actions">
            {ok && !editing && (
              <Button variant="quiet" onClick={() => setEditing(true)} disabled={busy}>
                Umbenennen
              </Button>
            )}
            <Button variant="quiet" onClick={() => setConfirming(true)} disabled={busy}>
              Löschen
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}
