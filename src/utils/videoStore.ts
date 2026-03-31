// ─── IndexedDB Video Store ───────────────────────────────────────
// Stores recorded video blobs in IndexedDB for up to 7 days.
// Max 15 recordings stored at a time.

const DB_NAME = 'meetRecorderDB';
const STORE_NAME = 'recordings';
const DB_VERSION = 1;
const MAX_RECORDINGS = 15;
const RETENTION_DAYS = 7;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export interface StoredRecording {
  id: string;
  blob: Blob;
  filename: string;
  createdAt: number;
}

/** Save a video blob to IndexedDB */
export async function saveRecording(id: string, blob: Blob, filename: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const record: StoredRecording = {
      id,
      blob,
      filename,
      createdAt: Date.now(),
    };

    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/** Get a video blob from IndexedDB */
export async function getRecording(id: string): Promise<StoredRecording | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/** Delete a video from IndexedDB */
export async function deleteRecording(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/** Get all stored recording IDs */
export async function getAllRecordingIds(): Promise<string[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAllKeys();

    request.onsuccess = () => resolve(request.result as string[]);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/** Delete all stored recordings */
export async function clearAllRecordings(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/** Remove recordings older than 7 days and keep max 15 */
export async function cleanupOldRecordings(): Promise<void> {
  const db = await openDB();
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const allRecords: StoredRecording[] = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  // Find records to delete: older than 7 days
  const toDelete = allRecords.filter((r) => r.createdAt < cutoff);

  // Also enforce max limit: keep only newest MAX_RECORDINGS
  const sorted = allRecords
    .filter((r) => r.createdAt >= cutoff)
    .sort((a, b) => b.createdAt - a.createdAt);

  if (sorted.length > MAX_RECORDINGS) {
    toDelete.push(...sorted.slice(MAX_RECORDINGS));
  }

  if (toDelete.length === 0) { db.close(); return; }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const record of toDelete) {
      store.delete(record.id);
    }
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
