import type { ProjectSummary } from './types';

/** Gallery orders: last changed, last created (both newest first), name A–Z. */
export const PROJECT_SORTS = ['updated', 'created', 'name'] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

/** What the gallery shows: search text, order and the favourites filter. Never stored in a project. */
export interface ProjectQuery {
  readonly text: string;
  readonly sort: ProjectSort;
  readonly favoritesOnly: boolean;
}

export const DEFAULT_PROJECT_QUERY: ProjectQuery = { text: '', sort: 'updated', favoritesOnly: false };

const COLLATOR = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

/** Case-insensitive comparable form: NFKC, lower case, single spaces. */
export function normalizeSearchText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('de').replace(/\s+/g, ' ').trim();
}

const timeOf = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? -Infinity : t;
};

/**
 * The projects the gallery shows for a query, in order. `titleOf` is the name
 * the user sees (unnamed works show a date), so search and A–Z match the card.
 * Every word of the search must occur in the title (any case). Ties are broken
 * by the other dates and the id, so the order is always the same. Pure; the
 * input is not changed.
 */
export function queryProjects<T extends Pick<ProjectSummary, 'id' | 'createdAt' | 'updatedAt' | 'favorite'>>(
  items: readonly T[],
  query: ProjectQuery,
  titleOf: (item: T) => string,
): T[] {
  const words = normalizeSearchText(query.text).split(' ').filter(Boolean);
  const rows = items
    .filter((item) => !query.favoritesOnly || item.favorite)
    .map((item) => ({ item, title: titleOf(item), updated: timeOf(item.updatedAt), created: timeOf(item.createdAt) }))
    .filter((row) => {
      if (words.length === 0) return true;
      const title = normalizeSearchText(row.title);
      return words.every((word) => title.includes(word));
    });
  const byUpdated = (a: (typeof rows)[number], b: (typeof rows)[number]) => b.updated - a.updated;
  const byCreated = (a: (typeof rows)[number], b: (typeof rows)[number]) => b.created - a.created;
  const byName = (a: (typeof rows)[number], b: (typeof rows)[number]) => COLLATOR.compare(a.title, b.title);
  const order = query.sort === 'name' ? [byName, byUpdated] : query.sort === 'created' ? [byCreated, byUpdated] : [byUpdated, byCreated];
  rows.sort((a, b) => {
    for (const compare of order) {
      const d = compare(a, b);
      if (d !== 0 && !Number.isNaN(d)) return d;
    }
    return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
  });
  return rows.map((row) => row.item);
}

/** A stored gallery view (sort + favourites filter) read back safely; anything unknown falls back to the default. */
export function parseProjectView(value: unknown): Pick<ProjectQuery, 'sort' | 'favoritesOnly'> {
  const v = (typeof value === 'object' && value !== null ? value : {}) as { sort?: unknown; favoritesOnly?: unknown };
  return {
    sort: PROJECT_SORTS.includes(v.sort as ProjectSort) ? (v.sort as ProjectSort) : DEFAULT_PROJECT_QUERY.sort,
    favoritesOnly: v.favoritesOnly === true,
  };
}
