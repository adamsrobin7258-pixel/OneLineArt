import { parseWorkDefaults, type WorkDefaults } from '../../../core';

const KEY = 'one-line-art.defaults';

/** The user's starting values for new works (per device; never part of a project). */
export function loadWorkDefaults(): WorkDefaults {
  try {
    const raw = localStorage.getItem(KEY);
    return parseWorkDefaults(raw ? JSON.parse(raw) : null);
  } catch {
    // Blocked or damaged storage: the app's own defaults.
    return parseWorkDefaults(null);
  }
}

/** Stores the defaults; returns false if the device refused (they still apply until the app closes). */
export function saveWorkDefaults(defaults: WorkDefaults): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(defaults));
    return true;
  } catch {
    return false;
  }
}
