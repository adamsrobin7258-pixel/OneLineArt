import { STORE_NAMES, StorageError, type StorageBackend, type StorageOp, type StoreName } from '../../../core';

export const DB_NAME = 'one-line-art';
/** Bump together with an upgrade step when stores change. */
export const DB_VERSION = 1;

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

function mapError(error: unknown, fallback: 'read-failed' | 'write-failed'): StorageError {
  if (error instanceof StorageError) return error;
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'QuotaExceededError') return new StorageError('quota-exceeded', undefined, { cause: error });
  return new StorageError(fallback, error instanceof Error ? error.message : String(error), { cause: error });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new StorageError('unavailable', 'IndexedDB not available'));
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(new StorageError('unavailable', undefined, { cause: error }));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORE_NAMES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrades the schema: close so it is not blocked.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(new StorageError('unavailable', req.error?.message, { cause: req.error }));
    req.onblocked = () => reject(new StorageError('unavailable', 'Database blocked by another tab'));
  });
}

/**
 * IndexedDB implementation of the storage port. Blobs (original photo,
 * thumbnail) and typed arrays (path) are stored natively, not as strings.
 * `commit` writes all operations in ONE transaction (all or nothing).
 */
export function createIndexedDbBackend(): StorageBackend {
  let db: Promise<IDBDatabase> | null = null;
  const database = () => {
    db ??= openDatabase().catch((error: unknown) => {
      db = null;
      throw error;
    });
    return db;
  };

  return {
    async get(store: StoreName, key: string) {
      try {
        const tx = (await database()).transaction(store, 'readonly');
        return await request(tx.objectStore(store).get(key));
      } catch (error) {
        throw mapError(error, 'read-failed');
      }
    },
    async entries(store: StoreName) {
      try {
        const tx = (await database()).transaction(store, 'readonly');
        const os = tx.objectStore(store);
        const [keys, values] = await Promise.all([request(os.getAllKeys()), request(os.getAll())]);
        return keys.map((k, i) => [String(k), values[i]] as const);
      } catch (error) {
        throw mapError(error, 'read-failed');
      }
    },
    async commit(ops: readonly StorageOp[]) {
      if (ops.length === 0) return;
      try {
        const stores = [...new Set(ops.map((op) => op.store))];
        const tx = (await database()).transaction(stores, 'readwrite');
        const done = new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
          tx.onerror = () => reject(tx.error);
        });
        for (const op of ops) {
          const os = tx.objectStore(op.store);
          if (op.type === 'put') os.put(op.value, op.key);
          else os.delete(op.key);
        }
        await done;
      } catch (error) {
        throw mapError(error, 'write-failed');
      }
    },
  };
}
