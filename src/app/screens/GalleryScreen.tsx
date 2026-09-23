import { useEffect, useId, useRef, useState } from 'react';
import { STORAGE_LIMITS, storageErrorCode, type ProjectSummary, type StorageErrorCode } from '../../core';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { Icon } from '../../ui/components/Icon';
import { StatusPanel } from '../../ui/components/StatusPanel';
import { CUSTOM_DETAIL_LABEL, DETAIL_LEVEL_LABELS, DRAWING_STYLE_LABELS } from '../drawingLabels';
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
const DAY_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long' });
const titleOf = (item: ProjectSummary) =>
  item.name || (item.status === 'ok' && !Number.isNaN(Date.parse(item.createdAt)) ? DAY_FORMAT.format(new Date(item.createdAt)) : 'Unbenanntes Werk');

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

  const count = items?.length ?? 0;
  return (
    <section className="gallery" data-testid="gallery-screen" data-count={items?.length ?? ''}>
      <header className="gallery__header">
        <div>
          <h1 className="gallery__heading">Meine Werke</h1>
          {count > 0 && <p className="gallery__count">{count === 1 ? '1 Werk' : `${count} Werke`} auf diesem Gerät</p>}
        </div>
        {onBack && (
          <Button variant="quiet" onClick={onBack}>
            <Icon name="arrowLeft" size={18} />
            Zurück
          </Button>
        )}
      </header>
      {error && (
        <p className="notice notice--error" role="alert" data-testid="gallery-error">
          <Icon name="alert" size={18} />
          <span>
            <strong>{STORAGE_ERROR_MESSAGES[error].title}.</strong> {STORAGE_ERROR_MESSAGES[error].detail}
          </span>
        </p>
      )}
      {items === null ? (
        <StatusPanel busy title="Werke werden geladen …" />
      ) : items.length === 0 ? (
        <div className="empty" data-testid="gallery-empty">
          <svg className="empty__mark" viewBox="0 0 120 60" aria-hidden="true">
            <path d="M4 44c14-2 18-30 32-30s10 30 24 30 12-34 26-34 16 26 30 22" />
          </svg>
          <h2 className="empty__title">Noch keine Werke</h2>
          <p className="empty__text">Gespeicherte Zeichnungen erscheinen hier – jederzeit wieder zu öffnen, zu animieren und zu exportieren.</p>
          <Button onClick={onCreate}>Erstes Werk erstellen</Button>
        </div>
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
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const [name, setName] = useState(item.name);
  const inputId = useId();
  const thumbnail = item.thumbnail;

  // The object URL lives exactly as long as the card shows this thumbnail.
  useEffect(() => {
    if (!thumbnail || !img.current) return;
    const objectUrl = URL.createObjectURL(thumbnail.data as Blob);
    img.current.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [thumbnail]);

  const ok = item.status === 'ok';
  const title = titleOf(item);
  const problem = item.status === 'incompatible' ? 'Andere App-Version' : 'Beschädigt';
  return (
    <li className={`card${ok ? '' : ' card--problem'}`} data-testid="gallery-item" data-project-id={item.id} data-status={item.status}>
      <button type="button" className="card__open" onClick={onOpen} disabled={!ok || busy} aria-label={ok ? `${title} öffnen` : `${title} öffnen – nicht möglich (${problem})`}>
        {ok && thumbnail ? (
          <img ref={img} className="card__image" width={thumbnail.width} height={thumbnail.height} alt="" />
        ) : (
          <span className="card__placeholder">
            {!ok && <Icon name="alert" size={22} />}
            {ok ? '' : problem}
          </span>
        )}
        {busy && <span className="card__busy">Wird geöffnet …</span>}
      </button>
      <div className="card__meta">
        <div className="card__text">
          <p className="card__title">{title}</p>
          <p className="card__detail">
            {ok
              ? [item.style && DRAWING_STYLE_LABELS[item.style].label, item.custom ? CUSTOM_DETAIL_LABEL.label : item.detailLevel && DETAIL_LEVEL_LABELS[item.detailLevel].label, formatDate(item.updatedAt)].filter(Boolean).join(' · ')
              : item.status === 'incompatible'
                ? 'Mit einer anderen App-Version erstellt'
                : 'Kann nicht geöffnet werden'}
          </p>
        </div>
        <div className="card__actions">
          {ok && (
            <button
              type="button"
              className="icon-button"
              aria-label="Umbenennen"
              title="Umbenennen"
              disabled={busy}
              onClick={() => {
                setName(item.name);
                setDialog('rename');
              }}
            >
              <Icon name="pencil" size={18} />
            </button>
          )}
          <button type="button" className="icon-button" aria-label="Löschen" title="Löschen" disabled={busy} onClick={() => setDialog('delete')}>
            <Icon name="trash" size={18} />
          </button>
        </div>
      </div>

      <Dialog
        open={dialog === 'delete'}
        title="Werk wirklich löschen?"
        onClose={() => setDialog(null)}
        actions={
          <>
            <Button variant="quiet" onClick={() => setDialog(null)}>
              Abbrechen
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDialog(null);
                onDelete();
              }}
            >
              Endgültig löschen
            </Button>
          </>
        }
      >
        <p>„{title}“ wird von diesem Gerät entfernt. Das lässt sich nicht rückgängig machen.</p>
      </Dialog>

      <Dialog
        open={dialog === 'rename'}
        title="Werk umbenennen"
        onClose={() => setDialog(null)}
        actions={
          <>
            <Button variant="quiet" onClick={() => setDialog(null)}>
              Abbrechen
            </Button>
            <Button type="submit" form={`${inputId}-form`}>
              Übernehmen
            </Button>
          </>
        }
      >
        <form
          id={`${inputId}-form`}
          onSubmit={(e) => {
            e.preventDefault();
            setDialog(null);
            onRename(name);
          }}
        >
          <label className="field" htmlFor={inputId}>
            <span className="field__label">Name</span>
            <input id={inputId} className="field__input" value={name} maxLength={STORAGE_LIMITS.maxNameLength} placeholder={formatDate(item.createdAt)} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
        </form>
      </Dialog>
    </li>
  );
}
