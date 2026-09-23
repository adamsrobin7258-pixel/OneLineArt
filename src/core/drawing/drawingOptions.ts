import type { EngineParameterPatch } from './parameterPatch';

/**
 * PREPARED options (no user control yet). Each option maps to an engine
 * parameter patch; `null` marks an option that is defined but not yet
 * calibrated/available, so it cannot be selected by accident.
 */

/** How the line moves. */
export const LINE_CHARACTERS = ['calm', 'balanced', 'organic', 'dynamic'] as const;
export type LineCharacter = (typeof LINE_CHARACTERS)[number];
export const DEFAULT_LINE_CHARACTER: LineCharacter = 'balanced';
/**
 * Levers for a later calibration: curvaturePenalty, contourAlignment,
 * smoothingIterations/Ratio, neighborCount (exploration).
 */
export const LINE_CHARACTER_PROFILES: Readonly<Record<LineCharacter, EngineParameterPatch | null>> = {
  calm: null,
  balanced: {},
  organic: null,
  dynamic: null,
};

/**
 * How self-crossings are treated. 'minimize' is the Part 4 behaviour
 * (2-opt removes crossings unless untangling forces sharp turns). Crossings can
 * never split the line: the path stays one ordered point list in every style.
 */
export const CROSSING_STYLES = ['minimize', 'allow', 'encourage'] as const;
export type CrossingStyle = (typeof CROSSING_STYLES)[number];
export const DEFAULT_CROSSING_STYLE: CrossingStyle = 'minimize';
export const CROSSING_STYLE_PROFILES: Readonly<Record<CrossingStyle, EngineParameterPatch | null>> = {
  minimize: {},
  allow: null,
  encourage: null,
};

/** Where the line starts. 'fixed' uses normalized coordinates (0..1). */
export type StartPointMode = { readonly mode: 'auto' } | { readonly mode: 'fixed'; readonly x: number; readonly y: number };
export const DEFAULT_START_POINT: StartPointMode = { mode: 'auto' };
