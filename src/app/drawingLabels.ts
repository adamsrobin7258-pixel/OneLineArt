import type { OneLineDetailLevel, PathErrorCode, RenderColorMode } from '../core';
import type { UserMessage } from './importMessages';

/** User-facing names of the detail levels. No technical terms. */
export const DETAIL_LEVEL_LABELS: Record<OneLineDetailLevel, { readonly label: string; readonly hint: string }> = {
  minimal: { label: 'Minimal', hint: 'Weniger Linien, klare Formen' },
  balanced: { label: 'Balanced', hint: 'Ausgewogen zwischen Klarheit und Detail' },
  detail: { label: 'Detail', hint: 'Mehr feine Strukturen und Details' },
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

/** The two user-facing display choices and the render mode behind each. No technical terms. */
export const DISPLAY_OPTIONS: readonly { readonly value: 'black' | 'color'; readonly label: string; readonly hint: string; readonly colorMode: RenderColorMode }[] = [
  { value: 'black', label: 'Schwarz', hint: 'Klassische Linie in Schwarz', colorMode: 'monochrome' },
  { value: 'color', label: 'Farbe', hint: 'Die Linie übernimmt die Farben des Fotos', colorMode: 'sampled-color' },
];

/** Current display choice for the render settings' colour mode. */
export const displayOf = (colorMode: RenderColorMode) => DISPLAY_OPTIONS.find((o) => o.colorMode === colorMode) ?? DISPLAY_OPTIONS[0]!;
