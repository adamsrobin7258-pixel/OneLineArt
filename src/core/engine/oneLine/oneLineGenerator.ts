import type { OneLinePathGenerator } from '../types';
import { generateOneLine, ONE_LINE_ENGINE_ID } from './generateOneLine';
import { DEFAULT_ENGINE_PARAMETERS, ONE_LINE_ENGINE_VERSION, type OneLineEngineParameters } from './parameters';

/** The One-Line engine behind the Part 1 generator interface. */
export function createOneLineGenerator(parameters: OneLineEngineParameters = DEFAULT_ENGINE_PARAMETERS): OneLinePathGenerator {
  return {
    id: ONE_LINE_ENGINE_ID,
    version: ONE_LINE_ENGINE_VERSION,
    generate: (input, context) => generateOneLine(input, parameters, context).path,
  };
}

export const oneLineGenerator = createOneLineGenerator();
