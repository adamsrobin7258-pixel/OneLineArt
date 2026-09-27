import { LEGACY_ENGINE_IDS, ONE_LINE_ENGINE_ID, ORTHOGONAL_ENGINE_ID, isAvailableEngine } from '../engine';
import type { EngineParameterPatch } from './parameterPatch';

/** The drawing styles offered for new drawings (phase 16: Organic and Orthogonal). */
export const DRAWING_STYLES = ['organic', 'orthogonal'] as const;
export type SelectableDrawingStyle = (typeof DRAWING_STYLES)[number];

/**
 * Styles only known from older projects (phase 16 removed Geometric). They
 * stay readable — a stored project keeps its line — but are never offered or
 * generated again: resolving their settings gives the replacement style.
 */
export const LEGACY_DRAWING_STYLES = ['geometric'] as const;
export type LegacyDrawingStyle = (typeof LEGACY_DRAWING_STYLES)[number];

/** Every style a stored project may name. */
export const KNOWN_DRAWING_STYLES = [...DRAWING_STYLES, ...LEGACY_DRAWING_STYLES] as const;
export type DrawingStyle = (typeof KNOWN_DRAWING_STYLES)[number];
export const DEFAULT_DRAWING_STYLE: SelectableDrawingStyle = 'organic';

/** What a legacy style becomes when its project gets a new line (decided in phase 16). */
export const LEGACY_STYLE_REPLACEMENTS: Readonly<Record<LegacyDrawingStyle, SelectableDrawingStyle>> = { geometric: 'organic' };

export const isLegacyDrawingStyle = (style: DrawingStyle): style is LegacyDrawingStyle => (LEGACY_DRAWING_STYLES as readonly string[]).includes(style);

/** The style a new line of this style is drawn in. */
export const currentDrawingStyle = (style: DrawingStyle): SelectableDrawingStyle => (isLegacyDrawingStyle(style) ? LEGACY_STYLE_REPLACEMENTS[style] : style);

export interface DrawingStyleProfile {
  /** Engine (registry id) that generates this style's path. */
  readonly engineId: string;
  /** Engine parameters this style changes on top of the detail profile. */
  readonly parameters: EngineParameterPatch;
  /** Whether the style uses line smoothing (the smoothing control applies). */
  readonly smoothing: boolean;
  /** Whether the detail level changes this style's line (the detail control applies). */
  readonly detail: boolean;
}

/**
 * THE place where styles are defined. A new style = a new engine in the
 * engine registry + one entry here; nothing else branches on the style.
 */
export const DRAWING_STYLE_PROFILES: Readonly<Record<SelectableDrawingStyle, DrawingStyleProfile>> = {
  // The phase 4–11 engine; phase 16 sets its line density per detail level (detailLevels.ts).
  organic: { engineId: ONE_LINE_ENGINE_ID, parameters: {}, smoothing: true, detail: true },
  // Phase 16: the labyrinth line of phase 15.4 (3 px lattice, width carries the tone). No smoothing, no detail levels.
  orthogonal: { engineId: ORTHOGONAL_ENGINE_ID, parameters: {}, smoothing: false, detail: false },
};

/** Whether the detail level changes the line of this style (Orthogonal: no, its spacing is fixed). */
export const styleUsesDetail = (style: DrawingStyle): boolean => DRAWING_STYLE_PROFILES[currentDrawingStyle(style)].detail;

/** Whether line smoothing applies to this style. */
export const styleUsesSmoothing = (style: DrawingStyle): boolean => DRAWING_STYLE_PROFILES[currentDrawingStyle(style)].smoothing;

/** Engine ids of styles before phase 16 (for stored projects). */
export const LEGACY_STYLE_ENGINE_IDS: readonly string[] = Object.values(LEGACY_ENGINE_IDS);

/** Whether stored settings can still be run as they are (their engine exists). */
export const isRunnableEngine = (engineId: string): boolean => isAvailableEngine(engineId);
