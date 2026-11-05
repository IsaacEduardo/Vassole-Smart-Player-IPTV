// Armazenamento local em IndexedDB. Usado pela página e pelo worker de sincronização.
const NAME = 'sintonia';
const VERSION = 1;
let dbp = null;

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('playlists', { keyPath: 'id' });
      db.createObjectStore('items', { keyPath: 'key' }).createIndex('pk', ['pid', 'kind']);
      db.createObjectStore('categories', { keyPath: 'key' }).createIndex('pk', ['pid', 'kind']);
      db.createObjectStore('epg', { keyPath: ['pid', 'ch'] });
      db.createObjectStore('favorites', { keyPath: 'key' }).createIndex('pid', 'pid');
      db.createObjectStore('history', { keyPath: 'key' }).createIndex('pid', 'pid');
      db.createObjectStore('settings', { keyPath: 'k' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Banco de dados bloqueado por outra aba'));
  });
  return dbp;
}

const p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });

export async function get(store, key) {
  const db = await openDB();
  return p(db.transaction(store).objectStore(store).get(key));
}

export async function getAll(store, index, query) {
  const db = await openDB();
  const os = db.transaction(store).objectStore(store);
  return p(index ? os.index(index).getAll(query) : os.getAll(query));
}

export async function put(store, value) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return done(tx);
}

export async function del(store, key) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return done(tx);
}

export async function putMany(store, values, batch = 2000) {
  const db = await openDB();
  for (let i = 0; i < values.length; i += batch) {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const v of values.slice(i, i + batch)) os.put(v);
    await done(tx);
  }
}

export async function deleteWhere(store, index, query) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const src = index ? tx.objectStore(store).index(index) : tx.objectStore(store);
  const req = src.openKeyCursor(query);
  req.onsuccess = () => {
    const c = req.result;
    if (!c) return;
    tx.objectStore(store).delete(c.primaryKey);
    c.continue();
  };
  return done(tx);
}

export async function clearStore(store) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  return done(tx);
}

export const epgRange = (pid) => IDBKeyRange.bound([pid, ''], [pid, '￿']);

export async function clearPlaylistContent(pid) {
  for (const kind of ['live', 'movie', 'series']) {
    await deleteWhere('items', 'pk', IDBKeyRange.only([pid, kind]));
    await deleteWhere('categories', 'pk', IDBKeyRange.only([pid, kind]));
  }
}

export async function deletePlaylist(pid) {
  await clearPlaylistContent(pid);
  await deleteWhere('epg', null, epgRange(pid));
  await deleteWhere('favorites', 'pid', IDBKeyRange.only(pid));
  await deleteWhere('history', 'pid', IDBKeyRange.only(pid));
  await del('playlists', pid);
}

export async function getSetting(k, def) {
  const r = await get('settings', k);
  return r === undefined ? def : r.v;
}
export const setSetting = (k, v) => put('settings', { k, v });
