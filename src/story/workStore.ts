// 학생별 "만들던 동화"를 이 기기(브라우저 IndexedDB)에 보관한다.
// 같은 기기에서 같은 학교명·학년·반·번호·이름으로 다시 들어오면 이어서 만들 수 있다.
// 그림(base64)이 커서 localStorage(약 5MB) 대신 IndexedDB를 쓴다. 서버에는 저장하지 않는다.

const DB_NAME = "geumsan-story-work";
const STORE = "works";
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 사흘 지난 작업은 지운다(같은 기기를 다른 반이 쓰므로)

export type StoredWork<T> = { owner: string; savedAt: number; data: T };

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "owner" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<R>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<R>): Promise<R | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(request.result ?? null);
      };
      tx.onerror = () => {
        db.close();
        resolve(null);
      };
      tx.onabort = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function saveWork<T>(owner: string, data: T) {
  if (!owner) return;
  await run("readwrite", (store) => store.put({ owner, savedAt: Date.now(), data } satisfies StoredWork<T>));
}

export async function loadWork<T>(owner: string): Promise<T | null> {
  if (!owner) return null;
  const found = (await run("readonly", (store) => store.get(owner))) as StoredWork<T> | null;
  if (!found) return null;
  if (Date.now() - found.savedAt > MAX_AGE_MS) {
    await clearWork(owner);
    return null;
  }
  return found.data;
}

export async function clearWork(owner: string) {
  if (!owner) return;
  await run("readwrite", (store) => store.delete(owner));
}

// 오래된 작업 정리 (앱을 열 때 한 번)
export async function pruneOldWorks() {
  const all = (await run("readonly", (store) => store.getAll())) as StoredWork<unknown>[] | null;
  if (!all) return;
  for (const work of all) {
    if (Date.now() - work.savedAt > MAX_AGE_MS) await clearWork(work.owner);
  }
}
