import { parseProjectView, type ProjectQuery } from '../../../core';

const KEY = 'one-line-art.gallery-view';

/** The remembered gallery order and favourites filter (a per-device preference, never project data). */
export function loadGalleryView(): Pick<ProjectQuery, 'sort' | 'favoritesOnly'> {
  try {
    const raw = localStorage.getItem(KEY);
    return parseProjectView(raw ? JSON.parse(raw) : null);
  } catch {
    // Blocked or damaged storage: the defaults.
    return parseProjectView(null);
  }
}

export function saveGalleryView(view: Pick<ProjectQuery, 'sort' | 'favoritesOnly'>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ sort: view.sort, favoritesOnly: view.favoritesOnly }));
  } catch {
    // Not remembered; the gallery still works.
  }
}
