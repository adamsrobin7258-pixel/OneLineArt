import { DEFAULT_IMPORT_OPTIONS, type ImageFormat, type ImageImportErrorCode } from '../core';

export interface UserMessage {
  readonly title: string;
  readonly detail: string;
}

const MB = Math.round(DEFAULT_IMPORT_OPTIONS.maxFileBytes / (1024 * 1024));
const MP = Math.round(DEFAULT_IMPORT_OPTIONS.maxPixels / 1_000_000);

/** User-facing texts for import failures. No technical details by design. */
export const IMPORT_ERROR_MESSAGES: Record<ImageImportErrorCode, UserMessage> = {
  'invalid-file': { title: 'Diese Datei ist kein Bild', detail: 'Bitte ein Foto im Format JPG, PNG oder HEIC wählen.' },
  'unsupported-format': { title: 'Dieses Format wird nicht unterstützt', detail: 'Möglich sind JPG, PNG, HEIC und WebP.' },
  'heic-unsupported': {
    title: 'HEIC-Fotos kann dieser Browser nicht öffnen',
    detail: 'Bitte das Foto als JPG sichern oder Safari verwenden.',
  },
  corrupt: { title: 'Das Bild lässt sich nicht öffnen', detail: 'Die Datei ist möglicherweise beschädigt oder unvollständig.' },
  'read-failed': { title: 'Die Datei konnte nicht gelesen werden', detail: 'Bitte erneut versuchen oder eine andere Datei wählen.' },
  'file-too-large': { title: 'Die Datei ist zu groß', detail: `Bitte ein Bild unter ${MB} MB wählen.` },
  'dimensions-too-large': {
    title: 'Die Auflösung ist zu hoch',
    detail: `Bitte ein Bild mit höchstens ${MP} Megapixeln wählen.`,
  },
  'out-of-memory': {
    title: 'Nicht genug Speicher für dieses Bild',
    detail: 'Bitte andere Apps oder Tabs schließen oder ein kleineres Bild wählen.',
  },
  unknown: { title: 'Das hat nicht geklappt', detail: 'Bitte erneut versuchen.' },
};

export const FORMAT_LABELS: Record<ImageFormat, string> = { jpeg: 'JPG', png: 'PNG', webp: 'WebP', heic: 'HEIC', heif: 'HEIF' };

/** MIME types and extensions offered in the system picker. */
export const ACCEPTED_FILE_TYPES = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';
