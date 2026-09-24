import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { STORAGE_LIMITS, queryProjects, storageErrorCode, type ProjectSort, type ProjectSummary, type StorageErrorCode } from '../../core';
import { loadGalleryView, saveGalleryView } from '../../platform/browser/storage/galleryView';
import { isAndroidApp } from '../../platform/capacitor/runtime';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { Icon } from '../../ui/components/Icon';
import { SegmentedControl } from '../../ui/components/SegmentedControl';
import { StatusPanel } from '../../ui/components/StatusPanel';
import { CUSTOM_DETAIL_LABEL, DETAIL_LEVEL_LABELS, DRAWING_STYLE_LABELS } from '../drawingLabels';
import { STORAGE_ERROR_MESSAGES, projectImportMessage } from '../exportMessages';
import type { ProjectsController } from '../state/useProjects';

interface GalleryScreenProps {
  projects: ProjectsController;
  /** Opens a stored project; rejects with a StorageError. */
  onOpen: (id: string) => Promise<void>;
  /** Opens a stored project directly at the export step (its own stored settings). */
  onExport: (id: string) => Promise<void>;
  onCreate: () => void;
  onBack: (() => void) | null;
}

const DATE_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const formatDate = (iso: string) => (Number.isNaN(Date.parse(iso)) ? '' : DATE_FORMAT.format(new Date(iso)));
const DAY_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long' });
const titleOf = (item: ProjectSummary) =>
  item.name || (item.status === 'ok' && !Number.isNaN(Date.parse(item.createdAt)) ? DAY_FORMAT.format(new Date(item.createdAt)) : 'Unbenanntes Werk');

const SORT_OPTIONS: readonly { value: ProjectSort; label: string }[] = [
  { value: 'updated', label: 'Geändert' },
  { value: 'created', label: 'Erstellt' },
  { value: 'name', label: 'A–Z' },
];
const FILTER_OPTIONS = [
  { value: 'all', label: 'Alle' },
  { value: 'favorites', label: 'Favoriten' },
] as const;
const works = (n: number) => (n === 1 ? '1 Werk' : `${n} Werke`);

/** Name of a copy: "<title> – Kopie" (within the name limit). */
const copyName = (item: ProjectSummary) => {
  const suffix = ' – Kopie';
  return `${titleOf(item).slice(0, STORAGE_LIMITS.maxNameLength - suffix.length)}${suffix}`;
};

/**
 * "Meine Werke": the locally stored projects — search by name, sort, show only
 * favourites; open, export again, duplicate, mark as favourite, rename,
 * delete. Order and favourites filter are remembered on the device; the
 * search starts empty so no work ever seems to be missing.
 */
export function GalleryScreen({ projects, onOpen, onExport, onCreate, onBack }: GalleryScreenProps) {
  const [items, setItems] = useState<readonly ProjectSummary[] | null>(null);
  const [error, setError] = useState<StorageErrorCode | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const { list } = projects;
  const [view, setView] = useState(loadGalleryView);
  const [text, setText] = useState('');
  // Typing stays instant; filtering follows right after (no fixed delay).
  const deferredText = useDeferredValue(text);
  const shown = useMemo(() => (items ? queryProjects(items, { ...view, text: deferredText }, titleOf) : null), [items, view, deferredText]);
  const changeView = (patch: Partial<typeof view>) =>
    setView((current) => {
      const next = { ...current, ...patch };
      saveGalleryView(next);
      return next;
    });
  const favoritesHint = view.favoritesOnly && !deferredText.trim();

  // 13.6: import a ".onelineart" project file as a new work (never replaces one).
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<string | null>(null);
  const [importError, setImportError] = useState<StorageErrorCode | null>(null);
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    setImported(null);
    setImportError(null);
    try {
      const { name } = await projects.importFile(file);
      // Make sure the new work is visible: no search, all works (it is not a favourite).
      setText('');
      if (view.favoritesOnly) changeView({ favoritesOnly: false });
      setImported(name || 'Das Werk');
      setGeneration((g) => g + 1);
    } catch (e) {
      console.error('Project import failed', e);
      setImportError(storageErrorCode(e));
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };
  const importButton = (label: string, className?: string) => (
    <Button variant="quiet" className={className} aria-label="Werk importieren" disabled={importing} onClick={() => fileInput.current?.click()}>
      <Icon name="upload" size={18} />
      <span className="button__text">{importing ? 'Wird importiert …' : label}</span>
    </Button>
  );

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
  const filtered = shown !== null && shown.length !== count;
  return (
    <section className="gallery" data-testid="gallery-screen" data-count={items?.length ?? ''}>
      <header className="gallery__header">
        <div>
          <h1 className="gallery__heading">Meine Werke</h1>
          {count > 0 && (
            <p className="gallery__count" data-testid="gallery-count">
              {filtered ? `${shown.length} von ${count === 1 ? '1 Werk' : `${count} Werken`}` : `${works(count)} auf diesem Gerät`}
            </p>
          )}
        </div>
        <div className="gallery__header-actions">
          {importButton('Importieren', 'button--icon-mobile')}
          {onBack && (
            <Button variant="quiet" onClick={onBack}>
              <Icon name="arrowLeft" size={18} />
              Zurück
            </Button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          hidden
          data-testid="project-import-input"
          // Android apps cannot filter by an unknown extension: the file is checked on import instead.
          accept={isAndroidApp() ? undefined : '.onelineart'}
          onChange={(e) => void importFile(e.target.files?.[0])}
        />
      </header>
      {imported && (
        <p className="notice" role="status" data-testid="project-import-done">
          <Icon name="check" size={18} />
          <span>„{imported}“ wurde importiert.</span>
        </p>
      )}
      {importError && (
        <p className="notice notice--error" role="alert" data-testid="project-import-error">
          <Icon name="alert" size={18} />
          <span>
            <strong>{projectImportMessage(importError).title}.</strong> {projectImportMessage(importError).detail}
          </span>
        </p>
      )}
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
          {importButton('Werk importieren')}
        </div>
      ) : (
        <>
          <div className="gallery__tools" data-testid="gallery-tools">
            <label className="gallery__search">
              <Icon name="search" size={18} />
              <input
                type="search"
                className="field__input"
                aria-label="Werke durchsuchen"
                placeholder="Nach Namen suchen"
                enterKeyHint="search"
                autoComplete="off"
                spellCheck={false}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <SegmentedControl label="Sortierung" options={SORT_OPTIONS} value={view.sort} onChange={(sort) => changeView({ sort })} />
            <SegmentedControl label="Anzeigen" options={FILTER_OPTIONS} value={view.favoritesOnly ? 'favorites' : 'all'} onChange={(v) => changeView({ favoritesOnly: v === 'favorites' })} />
          </div>
          {shown?.length === 0 ? (
            <div className="empty empty--compact" data-testid="gallery-no-results">
              <h2 className="empty__title">{favoritesHint ? 'Noch keine Favoriten' : 'Keine passenden Werke'}</h2>
              <p className="empty__text">{favoritesHint ? 'Mit dem Stern auf einem Werk wird es zum Favoriten.' : 'Andere Suche versuchen oder alle Werke anzeigen.'}</p>
              <Button
                variant="quiet"
                onClick={() => {
                  setText('');
                  changeView({ favoritesOnly: false });
                }}
              >
                Alle Werke anzeigen
              </Button>
            </div>
          ) : (
            <ul className="gallery__grid">
              {(shown ?? items).map((item) => (
                <GalleryCard
                  key={item.id}
                  item={item}
                  date={view.sort === 'created' ? item.createdAt : item.updatedAt}
                  busy={busyId === item.id}
                  onOpen={() => void run(item.id, () => onOpen(item.id), false)}
                  onExport={() => void run(item.id, () => onExport(item.id), false)}
                  onDuplicate={() => void run(item.id, () => projects.duplicate(item.id, copyName(item)), true)}
                  onFavorite={() => void run(item.id, () => projects.setFavorite(item.id, !item.favorite), true)}
                  onRename={(name) => void run(item.id, () => projects.rename(item.id, name), true)}
                  onDelete={() => void run(item.id, () => projects.remove(item.id), true)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

interface GalleryCardProps {
  item: ProjectSummary;
  /** Date shown on the card (follows the chosen order: created or changed). */
  date: string;
  busy: boolean;
  onOpen: () => void;
  onExport: () => void;
  onDuplicate: () => void;
  onFavorite: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

function GalleryCard({ item, date, busy, onOpen, onExport, onDuplicate, onFavorite, onRename, onDelete }: GalleryCardProps) {
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
    <li
      className={`card${ok ? '' : ' card--problem'}${item.favorite ? ' is-favorite' : ''}`}
      data-testid="gallery-item"
      data-project-id={item.id}
      data-status={item.status}
      data-favorite={item.favorite ? 'true' : 'false'}
    >
      <button type="button" className="card__open" onClick={onOpen} disabled={!ok || busy} aria-label={ok ? `${title} öffnen` : `${title} öffnen – nicht möglich (${problem})`}>
        {ok && thumbnail ? (
          <img ref={img} className="card__image" width={thumbnail.width} height={thumbnail.height} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="card__placeholder">
            {!ok && <Icon name="alert" size={22} />}
            {ok ? '' : problem}
          </span>
        )}
        {busy && <span className="card__busy">Einen Moment …</span>}
      </button>
      {ok && (
        <button
          type="button"
          className={`card__favorite${item.favorite ? ' is-on' : ''}`}
          aria-pressed={item.favorite}
          aria-label={`Favorit: ${title}`}
          title={item.favorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
          disabled={busy}
          onClick={onFavorite}
        >
          <Icon name="star" size={20} filled={item.favorite} />
        </button>
      )}
      <div className="card__meta">
        <div className="card__text">
          <p className="card__title">{title}</p>
          <p className="card__detail">
            {ok
              ? [item.style && DRAWING_STYLE_LABELS[item.style].label, item.custom ? CUSTOM_DETAIL_LABEL.label : item.detailLevel && DETAIL_LEVEL_LABELS[item.detailLevel].label, formatDate(date)].filter(Boolean).join(' · ')
              : item.status === 'incompatible'
                ? 'Mit einer anderen App-Version erstellt'
                : 'Kann nicht geöffnet werden'}
          </p>
        </div>
        <div className="card__actions">
          {ok && (
            <>
              <button type="button" className="icon-button" aria-label="Erneut exportieren" title="Erneut exportieren" disabled={busy} onClick={onExport}>
                <Icon name="download" size={18} />
              </button>
              <button type="button" className="icon-button" aria-label="Duplizieren" title="Duplizieren" disabled={busy} onClick={onDuplicate}>
                <Icon name="copy" size={18} />
              </button>
            </>
          )}
          {ok && (
            <button
              type="button"
              className="icon-button"
              aria-label="Umbenennen"
              title="Umbenennen"
              disabled={busy}
              onClick={() => {
                setName(item.name || title);
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
            <Button type="submit" form={`${inputId}-form`} disabled={name.trim() === ''}>
              Übernehmen
            </Button>
          </>
        }
      >
        <form
          id={`${inputId}-form`}
          onSubmit={(e) => {
            e.preventDefault();
            // Empty names are not stored; the dialog stays open.
            if (name.trim() === '') return;
            setDialog(null);
            onRename(name);
          }}
        >
          <label className="field" htmlFor={inputId}>
            <span className="field__label">Name</span>
            <input id={inputId} className="field__input" value={name} maxLength={STORAGE_LIMITS.maxNameLength} placeholder={title} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          {name.trim() === '' && <p className="field__hint">Bitte einen Namen eingeben.</p>}
        </form>
      </Dialog>
    </li>
  );
}
