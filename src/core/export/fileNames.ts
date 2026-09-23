/** Default base name when the project has no name. */
export const DEFAULT_FILE_BASE_NAME = 'OneLine';
const MAX_BASE_NAME_LENGTH = 40;

const pad = (n: number) => String(n).padStart(2, '0');

/** Keeps letters (incl. umlauts), digits, '-' and '_'; spaces become '_'. */
export function sanitizeFileBaseName(name: string | null | undefined): string {
  const cleaned = (name ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, MAX_BASE_NAME_LENGTH);
  return cleaned || DEFAULT_FILE_BASE_NAME;
}

/**
 * Readable export file name: `<Projekt|OneLine>_YYYY-MM-DD_HHMM.<ext>`
 * (local time of `date`), e.g. `OneLine_2026-09-23_1430.png`.
 */
export function exportFileName(params: { readonly projectName?: string | null | undefined; readonly date: Date; readonly extension: string }): string {
  const { date } = params;
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date');
  const extension = params.extension.replace(/^\./, '').toLowerCase();
  if (!/^[a-z0-9]{1,5}$/.test(extension)) throw new RangeError(`Invalid extension "${params.extension}"`);
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `${sanitizeFileBaseName(params.projectName)}_${stamp}.${extension}`;
}
