import { currentDrawingStyle, type DrawingStyle, type OneLineDetailLevel, type PathErrorCode, type RenderColorMode } from '../core';
import type { UserMessage } from './importMessages';

/** User-facing names of the detail levels. No technical terms. */
export const DETAIL_LEVEL_LABELS: Record<OneLineDetailLevel, { readonly label: string; readonly hint: string }> = {
  minimal: { label: 'Minimal', hint: 'Weniger Linien, klare Formen' },
  balanced: { label: 'Balanced', hint: 'Ausgewogen zwischen Klarheit und Detail' },
  detail: { label: 'Detail', hint: 'Mehr feine Strukturen und Details' },
};

/** Shown instead of a preset when detail or smoothing were adjusted by hand. */
export const CUSTOM_DETAIL_LABEL = { label: 'Eigene', hint: 'Eigene Einstellung unter „Anpassen“' } as const;

/**
 * User-facing names of the drawing styles; `straight` explains why smoothing is off in styles without it.
 * Geometric (phase 16: no longer offered) keeps its name for older works in the gallery.
 */
export const DRAWING_STYLE_LABELS: Record<DrawingStyle, { readonly label: string; readonly hint: string; readonly straight?: string; readonly fixedDetail?: string }> = {
  organic: { label: 'Organisch', hint: 'Weiche, frei fließende Linie' },
  orthogonal: {
    label: 'Orthogonal',
    hint: 'Nur waagerechte und senkrechte Linien, rechte Winkel',
    straight: 'Im orthogonalen Stil bleiben die Linien gerade',
    fixedDetail: 'Im orthogonalen Stil bleibt der Linienabstand immer gleich',
  },
  geometric: { label: 'Geometrisch', hint: 'Gerade Linien mit klaren Ecken', straight: 'Im geometrischen Stil bleiben die Linien gerade' },
};

/** Caption of the style choice for an older work in a style that is no longer offered. */
export const legacyStyleHint = (style: DrawingStyle): string =>
  `Älterer Stil „${DRAWING_STYLE_LABELS[style].label}“ – eine Änderung zeichnet die Linie im Stil „${DRAWING_STYLE_LABELS[currentDrawingStyle(style)].label}“ neu`;

export const PATH_ERROR_MESSAGES: Record<PathErrorCode, UserMessage> = {
  'analysis-missing': { title: 'Das Bild ist noch nicht bereit', detail: 'Bitte einen Moment warten und erneut versuchen.' },
  aborted: { title: 'Die Berechnung hat zu lange gedauert', detail: 'Bitte erneut versuchen oder eine geringere Detailstufe wählen.' },
  'out-of-memory': { title: 'Nicht genug Speicher für diese Zeichnung', detail: 'Bitte andere Apps schließen oder eine geringere Detailstufe wählen.' },
  'invalid-parameters': { title: 'Die Zeichnung konnte nicht berechnet werden', detail: 'Bitte erneut versuchen.' },
  'invalid-analysis': { title: 'Die Zeichnung konnte nicht berechnet werden', detail: 'Bitte das Bild erneut auswählen.' },
  'invalid-result': { title: 'Die Zeichnung konnte nicht berechnet werden', detail: 'Bitte erneut versuchen.' },
  'generation-failed': { title: 'Die Zeichnung konnte nicht berechnet werden', detail: 'Bitte erneut versuchen.' },
};

/** The user-facing colour choices and the render mode behind each. No technical terms. */
export const DISPLAY_OPTIONS: readonly { readonly value: 'single' | 'gradient' | 'photo'; readonly label: string; readonly hint: string; readonly colorMode: RenderColorMode }[] = [
  { value: 'single', label: 'Einfarbig', hint: 'Eine Linienfarbe, klassisch Schwarz', colorMode: 'monochrome' },
  { value: 'gradient', label: 'Verlauf', hint: 'Farbverlauf entlang der Linie', colorMode: 'gradient' },
  { value: 'photo', label: 'Foto', hint: 'Die Linie übernimmt die Farben des Fotos', colorMode: 'sampled-color' },
];

/** Caption of the monochrome choice when the line turns light on a dark background. */
export const LIGHT_LINE_HINT = 'Einfarbige Linie – auf dunklem Grund hell';

/** Caption of the monochrome choice with a colour the user picked. */
export const OWN_LINE_COLOR_HINT = 'Eigene Linienfarbe (unter „Anpassen“ → Farbe)';

/** Current display choice for the render settings' colour mode. */
export const displayOf = (colorMode: RenderColorMode) => DISPLAY_OPTIONS.find((o) => o.colorMode === colorMode) ?? DISPLAY_OPTIONS[0]!;
