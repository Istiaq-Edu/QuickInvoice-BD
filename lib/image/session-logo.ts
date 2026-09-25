/**
 * Session-only logo storage for guests.
 *
 * Guest logos must never reach the server, so the cropped file is kept in the
 * browser. IndexedDB stores the Blob natively; sessionStorage would force a
 * base64 data URL, which blows past its quota for anything but a tiny image.
 *
 * Every function degrades to an in-memory value when IndexedDB is unavailable
 * (private browsing, blocked storage) so a guest upload never hard fails.
 */

const DB_NAME = "quickinvoice-bd"
const DB_VERSION = 1
const STORE = "session-logos"
const KEY = "guest-logo"

export type SessionLogo = {
  blob: Blob
  name: string
  width: number | null
  height: number | null
}

let memoryFallback: SessionLogo | null = null

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null)
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    // A blocked or denied database should never break the upload flow.
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDatabase().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null)
          return
        }
        try {
          const request = run(db.transaction(STORE, mode).objectStore(STORE))
          request.onsuccess = () => resolve(request.result ?? null)
          request.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      }),
  )
}

export async function saveSessionLogo(logo: SessionLogo) {
  memoryFallback = logo
  await transact("readwrite", (store) => store.put(logo, KEY))
}

export async function loadSessionLogo(): Promise<SessionLogo | null> {
  const stored = await transact<SessionLogo>("readonly", (store) => store.get(KEY))
  if (stored?.blob) return stored
  return memoryFallback
}

export async function clearSessionLogo() {
  memoryFallback = null
  await transact("readwrite", (store) => store.delete(KEY))
}
