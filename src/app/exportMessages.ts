import type { ExportErrorCode, StorageErrorCode } from '../core';
import type { UserMessage } from './importMessages';

/** User-facing export errors. Technical details only go to the console. */
export const EXPORT_ERROR_MESSAGES: Record<ExportErrorCode, UserMessage> = {
  'invalid-settings': { title: 'Diese Einstellung ist nicht möglich', detail: 'Bitte eine andere Auswahl treffen.' },
  'size-unsupported': { title: 'Diese Größe wird nicht unterstützt', detail: 'Bitte eine kleinere Auflösung wählen.' },
  'out-of-memory': { title: 'Nicht genug Speicher für diese Größe', detail: 'Bitte eine kleinere Auflösung wählen oder andere Apps schließen.' },
  'encoder-unavailable': { title: 'Dieser Browser kann keine Videos erstellen', detail: 'Bitte einen aktuellen Chrome, Edge oder Safari verwenden.' },
  'codec-unsupported': { title: 'Video in dieser Auflösung nicht möglich', detail: 'Dieser Browser unterstützt die Größe nicht. Bitte eine kleinere Auflösung wählen.' },
  'encoding-failed': { title: 'Die Datei konnte nicht erstellt werden', detail: 'Bitte erneut versuchen.' },
  'invalid-project': { title: 'Es gibt noch keine fertige Zeichnung', detail: 'Bitte zuerst eine Zeichnung erstellen.' },
  'save-failed': { title: 'Die Datei konnte nicht gespeichert werden', detail: 'Bitte freien Speicher prüfen und erneut versuchen.' },
  cancelled: { title: 'Export abgebrochen', detail: 'Es wurde keine Datei erstellt.' },
};

export const STORAGE_ERROR_MESSAGES: Record<StorageErrorCode, UserMessage> = {
  unavailable: { title: 'Speichern ist hier nicht möglich', detail: 'Der Browser erlaubt keine lokale Speicherung (z. B. im privaten Modus).' },
  'quota-exceeded': { title: 'Der Speicher ist voll', detail: 'Bitte ältere Werke löschen und erneut versuchen.' },
  'not-found': { title: 'Dieses Werk gibt es nicht mehr', detail: 'Es wurde bereits gelöscht.' },
  damaged: { title: 'Dieses Werk ist beschädigt', detail: 'Es kann nicht geöffnet werden. Du kannst es löschen.' },
  'incompatible-version': { title: 'Dieses Werk kann nicht geöffnet werden', detail: 'Es wurde mit einer anderen App-Version erstellt.' },
  'invalid-project': { title: 'Dieses Werk kann nicht gespeichert werden', detail: 'Die Zeichnung ist unvollständig oder zu groß.' },
  'write-failed': { title: 'Speichern fehlgeschlagen', detail: 'Bitte erneut versuchen.' },
  'read-failed': { title: 'Laden fehlgeschlagen', detail: 'Bitte erneut versuchen.' },
};

/** Importing a ".onelineart" project file (13.6): file problems first, storage problems as usual. */
export function projectImportMessage(code: StorageErrorCode): UserMessage {
  if (code === 'damaged') return { title: 'Keine gültige Projektdatei', detail: 'Die Datei ist beschädigt oder keine One-Line-Projektdatei (.onelineart). Es wurde nichts verändert.' };
  if (code === 'incompatible-version') return { title: 'Projektdatei aus einer neueren App-Version', detail: 'Bitte die App aktualisieren und die Datei erneut importieren.' };
  if (code === 'read-failed') return { title: 'Die Datei konnte nicht gelesen werden', detail: 'Bitte erneut versuchen.' };
  return STORAGE_ERROR_MESSAGES[code];
}
