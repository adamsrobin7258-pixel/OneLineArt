import { DEFAULT_ONE_LINE_SETTINGS } from '../models';
import { DEFAULT_DETAIL_LEVEL, type OneLineDetailLevel } from './detailLevels';
import {
  DEFAULT_CROSSING_STYLE,
  DEFAULT_LINE_CHARACTER,
  DEFAULT_START_POINT,
  type CrossingStyle,
  type LineCharacter,
  type StartPointMode,
} from './drawingOptions';
import type { EngineParameterPatch } from './parameterPatch';

/**
 * What the user (or the app) chooses. Everything else is derived:
 * DrawingSettings → resolveOneLineSettings → EffectiveOneLineSettings → engine.
 */
export interface DrawingSettings {
  readonly detailLevel: OneLineDetailLevel;
  /** Same image + same settings + same seed ⇒ same path; another seed ⇒ a variant. */
  readonly seed: number;
  /** Prepared; only 'balanced' is available so far. */
  readonly lineCharacter: LineCharacter;
  /** Prepared; only 'minimize' is available so far. */
  readonly crossingStyle: CrossingStyle;
  /** Prepared; the UI offers 'auto' only. */
  readonly startPoint: StartPointMode;
  /** Expert/developer overrides applied last (not exposed in the normal UI). */
  readonly overrides: EngineParameterPatch;
}

export const DEFAULT_DRAWING_SETTINGS: DrawingSettings = {
  detailLevel: DEFAULT_DETAIL_LEVEL,
  seed: DEFAULT_ONE_LINE_SETTINGS.seed,
  lineCharacter: DEFAULT_LINE_CHARACTER,
  crossingStyle: DEFAULT_CROSSING_STYLE,
  startPoint: DEFAULT_START_POINT,
  overrides: {},
};
