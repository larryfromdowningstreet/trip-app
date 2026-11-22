// The phone's storage: one IndexedDB object store used as a key-value table.
// IndexedDB can hold CryptoKey objects as they are, so private keys never become bytes.

import type { KV } from '../core/vault';

const STORE = 'kv';

export async function openKV(name = 'trip'): Promise<KV> {
  const db = await done<IDBDatabase>(
    Object.assign(indexedDB.open(name, 1), {
      onupgradeneeded(this: IDBOpenDBRequest) {
        this.result.createObjectStore(STORE);
      },
    }),
  );
  const run = <T>(mode: IDBTransactionMode, act: (s: IDBObjectStore) => IDBRequest) =>
    done<T>(act(db.transaction(STORE, mode).objectStore(STORE)));

  return {
    get: (key) => run('readonly', (s) => s.get(key)),
    set: (key, value) => run('readwrite', (s) => s.put(value, key)),
    delete: (key) => run('readwrite', (s) => s.delete(key)),
    clear: () => run('readwrite', (s) => s.clear()),
  };
}

const done = <T>(request: IDBRequest) =>
  new Promise<T>((ok, fail) => {
    request.onsuccess = () => ok(request.result as T);
    request.onerror = () => fail(request.error);
  });
