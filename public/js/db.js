// Armazenamento local em IndexedDB. Usado pela página e pelo worker de sincronização.
const NAME = 'sintonia';

// Migrações em ordem: MIGRATIONS[n] leva o banco da versão n para n + 1.
// Nunca altere uma migração já publicada; acrescente uma nova no fim.
const MIGRATIONS = [
  (db) => { // 0 -> 1
    db.createObjectStore('playlists', { keyPath: 'id' });
    db.createObjectStore('items', { keyPath: 'key' }).createIndex('pk', ['pid', 'kind']);
    db.createObjectStore('categories', { keyPath: 'key' }).createIndex('pk', ['pid', 'kind']);
    db.createObjectStore('epg', { keyPath: ['pid', 'ch'] });
    db.createObjectStore('favorites', { keyPath: 'key' }).createIndex('pid', 'pid');
    db.createObjectStore('history', { keyPath: 'key' }).createIndex('pid', 'pid');
    db.createObjectStore('settings', { keyPath: 'k' });
  },
  (db) => { // 1 -> 2: legendas externas e preferências por filme ou episódio
    db.createObjectStore('subtitles', { keyPath: 'key' }).createIndex('pid', 'pid');
  },
];
export const DB_VERSION = MIGRATIONS.length;
export const STORES = ['playlists', 'items', 'categories', 'epg', 'favorites', 'history', 'settings', 'subtitles'];
let dbp = null;

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, DB_VERSION);
    r.onupgradeneeded = (e) => {
      for (let v = e.oldVersion; v < DB_VERSION; v++) MIGRATIONS[v](r.result, r.transaction);
    };
    r.onsuccess = () => {
      const db = r.result;
      // Outra aba (ou uma versão nova do app) precisa atualizar o banco: libera a conexão.
      db.onversionchange = () => {
        db.close();
        dbp = null;
        if (typeof location !== 'undefined' && typeof document !== 'undefined') location.reload();
      };
      resolve(db);
    };
    r.onerror = () => { dbp = null; reject(r.error); };
    // Uma aba antiga ainda usa o banco: a atualização continua assim que ela for fechada.
    r.onblocked = () => { if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('db-blocked')); };
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

// Apaga os registros do intervalo; com `keep`, preserva aqueles cuja chave primária ele aprovar.
export async function deleteWhere(store, index, query, keep) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const src = index ? tx.objectStore(store).index(index) : tx.objectStore(store);
  const req = src.openKeyCursor(query);
  req.onsuccess = () => {
    const c = req.result;
    if (!c) return;
    if (!keep || !keep(c.primaryKey)) tx.objectStore(store).delete(c.primaryKey);
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

const KINDS = ['live', 'movie', 'series'];

export async function clearPlaylistContent(pid) {
  for (const kind of KINDS) {
    await deleteWhere('items', 'pk', IDBKeyRange.only([pid, kind]));
    await deleteWhere('categories', 'pk', IDBKeyRange.only([pid, kind]));
  }
}

// Troca o conteúdo da playlist sem deixá-la vazia em caso de falha: grava os registros novos
// (as chaves são estáveis, então os existentes são sobrescritos) e só depois remove os que sumiram.
export async function replacePlaylistContent(pid, categories, items) {
  await putMany('categories', categories);
  await putMany('items', items);
  const keepCats = new Set(categories.map((c) => c.key));
  const keepItems = new Set(items.map((i) => i.key));
  for (const kind of KINDS) {
    await deleteWhere('items', 'pk', IDBKeyRange.only([pid, kind]), (k) => keepItems.has(k));
    await deleteWhere('categories', 'pk', IDBKeyRange.only([pid, kind]), (k) => keepCats.has(k));
  }
}

// Mesmo princípio para o guia: grava os canais novos e depois remove os que não vieram mais.
export async function replaceEpg(pid, recs) {
  await putMany('epg', recs, 500);
  const keep = new Set(recs.map((r) => r.ch));
  await deleteWhere('epg', null, epgRange(pid), (k) => keep.has(k[1]));
}

export async function deletePlaylist(pid) {
  await clearPlaylistContent(pid);
  await deleteWhere('epg', null, epgRange(pid));
  await deleteWhere('subtitles', 'pid', IDBKeyRange.only(pid));
  await deleteWhere('favorites', 'pid', IDBKeyRange.only(pid));
  await deleteWhere('history', 'pid', IDBKeyRange.only(pid));
  await del('playlists', pid);
}

export async function getSetting(k, def) {
  const r = await get('settings', k);
  return r === undefined ? def : r.v;
}
export const setSetting = (k, v) => put('settings', { k, v });
