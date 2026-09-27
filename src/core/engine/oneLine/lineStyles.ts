import { EngineError } from './errors';
import { ORGANIC_LINE_SHAPE, runOneLineEngine, type OneLineRunHooks, type OneLineRunInput, type OneLineRunResult } from './generateOneLine';
import type { OneLineEngineParameters } from './parameters';
import { ORTHOGONAL_ENGINE_ID, ORTHOGONAL_ENGINE_VERSION, generateOrthogonalLine } from '../maze/orthogonalEngine';

/**
 * Engine ids of styles that existed before phase 16. They are no longer
 * generated; projects that used them keep their stored line, and a new line
 * for such a project comes from the current style (see drawingStyles.ts).
 */
export const LEGACY_ENGINE_IDS = {
  /** Geometric style (straight 45°/90° lines), removed in phase 16. */
  geometric: 'geometric-stipple-tour',
  /** Orthogonal style before phase 16 (Manhattan tour over demand points). */
  orthogonal: 'orthogonal-stipple-tour',
} as const;

/** A path-generating style engine; all return the same OneLinePath format. */
export interface OneLineEngine {
  readonly id: string;
  readonly version: string;
  run(input: OneLineRunInput, parameters: OneLineEngineParameters, hooks: OneLineRunHooks): OneLineRunResult;
}

/**
 * Registry of the available engines by id (phase 16: Organic and Orthogonal).
 * New styles register here — no branching in the engine.
 */
export const ONE_LINE_ENGINES: Readonly<Record<string, OneLineEngine>> = {
  [ORGANIC_LINE_SHAPE.id]: {
    id: ORGANIC_LINE_SHAPE.id,
    version: ORGANIC_LINE_SHAPE.version,
    run: (input, parameters, hooks) => runOneLineEngine(ORGANIC_LINE_SHAPE, input, parameters, hooks),
  },
  [ORTHOGONAL_ENGINE_ID]: { id: ORTHOGONAL_ENGINE_ID, version: ORTHOGONAL_ENGINE_VERSION, run: generateOrthogonalLine },
};

/** True for an engine id this app can still run. */
export const isAvailableEngine = (id: string): boolean => Object.prototype.hasOwnProperty.call(ONE_LINE_ENGINES, id);

/** The engine for an id; unknown ids (including the legacy ones) are a controlled parameter error. */
export function oneLineEngine(id: string): OneLineEngine {
  const engine = isAvailableEngine(id) ? ONE_LINE_ENGINES[id] : undefined;
  if (!engine) throw new EngineError('invalid-parameters', `Unknown drawing engine "${id}"`);
  return engine;
}
