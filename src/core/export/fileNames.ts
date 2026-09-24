/** Default base name when the project has no (usable) name. */
export const DEFAULT_FILE_BASE_NAME = 'OneLine';
/** In code points (never splits a character). */
const MAX_BASE_NAME_LENGTH = 40;

const pad = (n: number) => String(n).padStart(2, '0');

/** Characters no common file system (Windows, Android, macOS, Linux) accepts in a name, and control characters. */
const INVALID_CHARACTERS = /[\\/:*?"<>|\p{Cc}]/gu;
/** Invisible format characters (zero-width, bidi overrides that could fake an extension, BOM). */
const INVISIBLE_CHARACTERS = /\p{Cf}/gu;
/** Leading/trailing spaces and dots: hidden files, and names Windows cannot keep. */
const EDGES = /^[\s._-]+|[\s._-]+$/gu;

/**
 * A safe, readable file base name from a project name: invalid and invisible
 * characters removed (invalid ones become a space), whitespace collapsed,
 * no leading/trailing dots or spaces, at most 40 characters. Letters incl.
 * umlauts, digits, spaces and ordinary punctuation stay. Empty → "OneLine".
 */
export function sanitizeFileBaseName(name: string | null | undefined): string {
  const cleaned = (name ?? '').normalize('NFC').replace(INVALID_CHARACTERS, ' ').replace(INVISIBLE_CHARACTERS, '').replace(/\s+/gu, ' ').replace(EDGES, '');
  const limited = Array.from(cleaned).slice(0, MAX_BASE_NAME_LENGTH).join('').replace(EDGES, '');
  return limited || DEFAULT_FILE_BASE_NAME;
}

/**
 * Readable export file name: `<Projekt|OneLine> YYYY-MM-DD HHMM.<ext>` (local
 * time of `date`), e.g. `Oma am Meer 2026-09-24 1430.png`. The time keeps
 * several exports of one work apart.
 */
export function exportFileName(params: { readonly projectName?: string | null | undefined; readonly date: Date; readonly extension: string }): string {
  const { date } = params;
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date');
  const extension = params.extension.replace(/^\./, '').toLowerCase();
  if (!/^[a-z0-9]{1,10}$/.test(extension)) throw new RangeError(`Invalid extension "${params.extension}"`);
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `${sanitizeFileBaseName(params.projectName)} ${stamp}.${extension}`;
}
