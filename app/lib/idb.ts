// Tiny IndexedDB adapter — the client's on-device persistence (replaces the Node data/ JSON files, M2).
// Two object stores in one database:
//   • "kv"         — small key→value docs; holds the whole ReviewStore under the key "reviews".
//   • "variations" — cached tutor question ladders, keyed by recall-prompt id.
// No external dependency: a thin promise wrapper over the raw IndexedDB API. All calls are browser-only —
// invoke them from effects/handlers, never during render (there is no IndexedDB on the server).
const DB_NAME = "brainquest";
const DB_VERSION = 1;
export const KV_STORE = "kv";
export const VARIATIONS_STORE = "variations";

/** The review store lives under this single key in the kv store. */
export const REVIEWS_KEY = "reviews";

let dbPromise: Promise<IDBDatabase> | null = null;

/** Open (and cache) the database, creating the object stores on first run / version bump. */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
      if (!db.objectStoreNames.contains(VARIATIONS_STORE)) db.createObjectStore(VARIATIONS_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/**
 * Promisify one request inside a fresh transaction on `store`, resolving on transaction COMPLETE (not
 * merely request success): for a readwrite put, the data is only durably committed at `tx.oncomplete`, so
 * an awaited write that resolved on `req.onsuccess` could report "saved" a moment before a commit that
 * then aborts (tab close / memory pressure), silently losing a grade. We resolve with the request result
 * captured in `onsuccess`, but only once the transaction has committed.
 */
async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = run(tx.objectStore(store));
    let result: T;
    req.onsuccess = () => {
      result = req.result as T;
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** Read a value by key (undefined if absent). */
export function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return withStore<T | undefined>(store, "readonly", (s) => s.get(key));
}

/** Write a value at key. */
export async function idbSet(store: string, key: IDBValidKey, value: unknown): Promise<void> {
  await withStore(store, "readwrite", (s) => s.put(value, key));
}
