import { STORE_NAMES, type StorageBackend, type StoreName } from './types';

/**
 * In-memory backend (tests, fallback). Keeps its data while the object lives,
 * so a new repository on the same backend simulates an app restart.
 */
export function createMemoryStorageBackend(): StorageBackend & { readonly stores: ReadonlyMap<StoreName, Map<string, unknown>> } {
  const stores = new Map<StoreName, Map<string, unknown>>(STORE_NAMES.map((name) => [name, new Map()]));
  return {
    stores,
    async get(store, key) {
      return stores.get(store)!.get(key);
    },
    async entries(store) {
      return [...stores.get(store)!.entries()];
    },
    async commit(ops) {
      for (const op of ops) {
        if (op.type === 'put') stores.get(op.store)!.set(op.key, op.value);
        else stores.get(op.store)!.delete(op.key);
      }
    },
  };
}
