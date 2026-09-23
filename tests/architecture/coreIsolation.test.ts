import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE = join(import.meta.dirname, '../../src/core');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : full.endsWith('.ts') ? [full] : [];
  });
}

const FORBIDDEN_IMPORTS = [/from ['"]react/, /from ['"].*\/(app|ui|platform)\//];
const FORBIDDEN_GLOBALS = [/\bMath\.random\(/, /\bdocument\./, /\bwindow\./, /\bDate\.now\(/];

describe('architecture: src/core', () => {
  const sources = files(CORE).map((f) => ({ file: relative(CORE, f), code: readFileSync(f, 'utf8') }));

  it('contains source files', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it.each(sources)('$file does not import UI or platform code', ({ code }) => {
    for (const pattern of FORBIDDEN_IMPORTS) expect(code).not.toMatch(pattern);
  });

  it.each(sources)('$file uses no non-deterministic or browser globals', ({ code }) => {
    for (const pattern of FORBIDDEN_GLOBALS) expect(code).not.toMatch(pattern);
  });
});
