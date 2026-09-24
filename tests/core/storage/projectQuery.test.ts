import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_QUERY, normalizeSearchText, parseProjectView, queryProjects, type ProjectQuery } from '../../../src/core';

interface Item {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly favorite: boolean;
}

const item = (id: string, name: string, created: number, updated: number, favorite = false): Item => ({
  id,
  name,
  createdAt: new Date(Date.UTC(2026, 0, created)).toISOString(),
  updatedAt: new Date(Date.UTC(2026, 0, updated)).toISOString(),
  favorite,
});

// Created order: Oma (1) < zebra (2) < Äpfel (3) < Bild 10 (4) < bild 2 (5); changed order differs on purpose.
const ITEMS: readonly Item[] = [
  item('a', 'Oma am Meer', 1, 20, true),
  item('b', 'zebra', 2, 10),
  item('c', 'Äpfel im Korb', 3, 30),
  item('d', 'Bild 10', 4, 5, true),
  item('e', 'bild 2', 5, 15),
];
const title = (i: Item) => i.name;
const ids = (query: Partial<ProjectQuery>, items: readonly Item[] = ITEMS) => queryProjects(items, { ...DEFAULT_PROJECT_QUERY, ...query }, title).map((i) => i.id);

describe('gallery query (13.4)', () => {
  it('defaults: all works, last changed first', () => {
    expect(DEFAULT_PROJECT_QUERY).toEqual({ text: '', sort: 'updated', favoritesOnly: false });
    expect(ids({})).toEqual(['c', 'a', 'e', 'b', 'd']);
  });

  it('sorts by last created (newest first)', () => {
    expect(ids({ sort: 'created' })).toEqual(['e', 'd', 'c', 'b', 'a']);
  });

  it('sorts by name A–Z: case-insensitive, umlauts with their letter, numbers numerically', () => {
    expect(ids({ sort: 'name' }).map((id) => ITEMS.find((i) => i.id === id)!.name)).toEqual(['Äpfel im Korb', 'bild 2', 'Bild 10', 'Oma am Meer', 'zebra']);
  });

  it('the order is strict: favourites are not pulled to the top', () => {
    expect(ids({ sort: 'updated' })[0]).toBe('c');
    expect(ids({ sort: 'created' }).indexOf('a')).toBe(4);
  });

  it('search: any case, part of the name, every word must match', () => {
    expect(ids({ text: 'oma' })).toEqual(['a']);
    expect(ids({ text: 'OMA' })).toEqual(['a']);
    expect(ids({ text: '  mEeR  ' })).toEqual(['a']);
    expect(ids({ text: 'BILD' })).toEqual(['e', 'd']);
    expect(ids({ text: 'meer oma' })).toEqual(['a']);
    expect(ids({ text: 'oma zebra' })).toEqual([]);
    expect(ids({ text: 'äpfel' })).toEqual(['c']);
    expect(ids({ text: 'ÄPFEL' })).toEqual(['c']);
  });

  it('search with decomposed umlauts finds composed names (and the other way round)', () => {
    expect(ids({ text: 'Äpfel' })).toEqual(['c']);
    expect(ids({ text: 'möwe' }, [item('m', 'Möwe', 1, 1)])).toEqual(['m']);
  });

  it('favourites filter', () => {
    expect(ids({ favoritesOnly: true })).toEqual(['a', 'd']);
  });

  it('search, order and favourites filter combine', () => {
    expect(ids({ text: 'bild', favoritesOnly: true })).toEqual(['d']);
    expect(ids({ text: 'm', sort: 'name' })).toEqual(['c', 'a']);
    expect(ids({ text: 'i', sort: 'created', favoritesOnly: true })).toEqual(['d']);
    expect(ids({ text: 'zebra', favoritesOnly: true })).toEqual([]);
  });

  it('no match → an empty list, never an error', () => {
    expect(ids({ text: 'gibt es nicht' })).toEqual([]);
    expect(ids({ favoritesOnly: true }, [item('x', 'x', 1, 1)])).toEqual([]);
    expect(ids({}, [])).toEqual([]);
  });

  it('searches and sorts by the title the user sees (unnamed works show a date)', () => {
    const unnamed = [item('u', '', 1, 1), item('n', 'Hafen', 2, 2)];
    const shownTitle = (i: Item) => i.name || '24. September 2026';
    expect(queryProjects(unnamed, { ...DEFAULT_PROJECT_QUERY, text: 'september' }, shownTitle).map((i) => i.id)).toEqual(['u']);
    expect(queryProjects(unnamed, { ...DEFAULT_PROJECT_QUERY, sort: 'name' }, shownTitle).map((i) => i.id)).toEqual(['u', 'n']);
  });

  it('is deterministic: equal keys fall back to the other date and the id; invalid dates go last', () => {
    const same = [item('y', 'Gleich', 1, 1), item('x', 'Gleich', 1, 1), { ...item('z', 'Gleich', 1, 1), updatedAt: '', createdAt: 'kaputt' }];
    expect(ids({}, same)).toEqual(['x', 'y', 'z']);
    expect(ids({ sort: 'name' }, same)).toEqual(['x', 'y', 'z']);
    expect(ids({ sort: 'created' }, same)).toEqual(['x', 'y', 'z']);
  });

  it('never changes the input', () => {
    const copy = ITEMS.map((i) => ({ ...i }));
    ids({ sort: 'name', text: 'a', favoritesOnly: true });
    expect(ITEMS).toEqual(copy);
  });

  it('many works: 5000 are searched and sorted quickly', () => {
    const many = Array.from({ length: 5000 }, (_, k) => item(`p${k}`, `Werk ${k} ${k % 7 === 0 ? 'Strand' : 'Stadt'}`, 1 + (k % 28), 1 + ((k * 13) % 28), k % 5 === 0));
    const started = performance.now();
    const result = ids({ text: 'strand', sort: 'name', favoritesOnly: true }, many);
    expect(performance.now() - started).toBeLessThan(300);
    expect(result).toHaveLength(many.filter((_, k) => k % 7 === 0 && k % 5 === 0).length);
    expect(result[0]).toBe('p0');
  });

  it('normalized search text', () => {
    expect(normalizeSearchText('  Oma   AM\tMeer ')).toBe('oma am meer');
    expect(normalizeSearchText('ＯＭＡ')).toBe('oma');
  });

  it('a stored view is read back safely (unknown values → defaults)', () => {
    expect(parseProjectView({ sort: 'name', favoritesOnly: true })).toEqual({ sort: 'name', favoritesOnly: true });
    expect(parseProjectView({ sort: 'rating', favoritesOnly: 'yes' })).toEqual({ sort: 'updated', favoritesOnly: false });
    expect(parseProjectView(null)).toEqual({ sort: 'updated', favoritesOnly: false });
    expect(parseProjectView('kaputt')).toEqual({ sort: 'updated', favoritesOnly: false });
  });
});
