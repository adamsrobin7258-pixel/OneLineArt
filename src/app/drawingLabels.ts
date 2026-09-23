import type { OneLineDetailLevel, PathErrorCode } from '../core';
import type { UserMessage } from './importMessages';

/** User-facing names of the detail levels. No technical terms. */
export const DETAIL_LEVEL_LABELS: Record<OneLineDetailLevel, { readonly label: string; readonly hint: string }> = {
  minimal: { label: 'Minimal', hint: 'Wenige Linien, große Formen' },
  balanced: { label: 'Balanced', hint: 'Ausgewogen' },
  detail: { label: 'Detail', hint: 'Feine Strukturen' },
};

export const PATH_ERROR_MESSAGES: Record<PathErrorCode, UserMessage> = {
  'analysis-missing': { title: 'Das Bild ist noch nicht bereit', detail: 'Bitte einen Moment warten und erneut versuchen.' },
  aborted: { title: 'Die Berechnung hat zu lange gedauert', detail: 'Bitte erneut versuchen oder eine geringere Detailstufe wählen.' },
  'out-of-memory': { title: 'Nicht genug Speicher für diese Zeichnung', detail: 'Bitte andere Apps schließen oder eine geringere Detailstufe wählen.' },
  'invalid-parameters': { title: 'Die Zeichnung konnte nicht berechnet werden', detail: 'Bitte erneut versuchen.' },
  'invalid-analysis': { title: 'Die Zeichnung konnte nicht berechnet werden', detail: 'Bitte das Bild erneut auswählen.' },
  'invalid-result': { title: 'Die Zeichnung konnte nicht berechnet werden', detail: 'Bitte erneut versuchen.' },
  'generation-failed': { title: 'Die Zeichnung konnte nicht berechnet werden', detail: 'Bitte erneut versuchen.' },
};
