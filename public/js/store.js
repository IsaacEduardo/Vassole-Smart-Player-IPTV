// Estado da aplicação: ajustes, playlist ativa, favoritos, histórico e guia.
import * as db from './db.js';
import { Xtream } from './xtream.js';
import { itemKey, b64utf8, normChannel } from './util.js';

export const DEFAULTS = {
  proxyMode: 'auto',      // auto | on | off
  ua: '',
  liveFormat: 'auto',     // auto | hls | ts
  aspect: 'contain',      // contain | cover | fill
  subSize: 'm',           // s | m | l | xl
  subColor: 'white',      // white | yellow
  subBg: 'semi',          // none | semi | solid
  subPos: 'bottom',       // bottom | raised | top
  subLang: '',            // idioma preferido da legenda ('' = não ativar sozinho)
  audioLang: '',          // idioma preferido do áudio ('' = o padrão do stream)
  langPrefs: [],          // idiomas preferidos, em ordem
  langHideOthers: false,  // esconder itens de outros idiomas (os sem idioma continuam visíveis)
  stripLangPrefix: false, // exibir "PT: SIC" como "SIC"
  autoUpdateHours: 24,
  epgUpdateHours: 12,
  active: null,
};

export const S = {
  settings: { ...DEFAULTS },
  playlists: [],
  pl: null,
  data: null,
  favs: new Map(),
  net: { proxy: false, ua: '' },
  proxyAvailable: false,
  epgCache: new Map(),
  alias: {},
  listeners: new Set(),
};

export function onChange(fn) { S.listeners.add(fn); return () => S.listeners.delete(fn); }
export function emit(what) { for (const fn of S.listeners) fn(what); }

export async function detectProxy() {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    const j = await r.json();
    S.proxyAvailable = !!j.proxy;
  } catch { S.proxyAvailable = false; }
  computeNet();
}

export function computeNet() {
  const m = S.settings.proxyMode;
  S.net = { proxy: m === 'on' || (m === 'auto' && S.proxyAvailable), ua: S.settings.ua || '', base: location.origin };
}

export async function loadSettings() {
  const all = await db.getAll('settings');
  for (const { k, v } of all) S.settings[k] = v;
  computeNet();
}
export async function setSetting(k, v) {
  S.settings[k] = v;
  await db.setSetting(k, v);
  if (k === 'proxyMode' || k === 'ua') computeNet();
}

export async function loadPlaylists() {
  S.playlists = (await db.getAll('playlists')).sort((a, b) => a.createdAt - b.createdAt);
  return S.playlists;
}

export async function activate(pid) {
  const pl = S.playlists.find((p) => p.id === pid) || null;
  S.pl = pl;
  S.epgCache.clear();
  S.alias = {};
  if (!pl) { S.data = null; S.favs.clear(); await setSetting('active', null); emit('playlist'); return; }
  await setSetting('active', pid);
  const [live, movie, series, cats, favs, aliasRec] = await Promise.all([
    db.getAll('items', 'pk', IDBKeyRange.only([pid, 'live'])),
    db.getAll('items', 'pk', IDBKeyRange.only([pid, 'movie'])),
    db.getAll('items', 'pk', IDBKeyRange.only([pid, 'series'])),
    db.getAll('categories'),
    db.getAll('favorites', 'pid', IDBKeyRange.only(pid)),
    db.get('epg', [pid, '\u0001alias']),
  ]);
  live.sort((a, b) => (a.num || 1e9) - (b.num || 1e9) || a.name.localeCompare(b.name));
  const byCat = (kind) => cats.filter((c) => c.pid === pid && c.kind === kind).sort((a, b) => a.order - b.order);
  S.data = {
    all: { live, movie, series },
    cats: { live: byCat('live'), movie: byCat('movie'), series: byCat('series') },
    byKey: new Map([...live, ...movie, ...series].map((i) => [i.key, i])),
    hasLang: live.some((i) => 'lang' in i) || movie.some((i) => 'lang' in i),
    langCounts: {}, versions: {},
  };
  rebuildLists();
  S.favs = new Map(favs.map((f) => [f.key, f]));
  S.alias = aliasRec?.map || {};
  emit('playlist');
}

// ---- Idiomas e versões ----
const KINDS = ['live', 'movie', 'series'];

// Listas visíveis conforme os idiomas escolhidos, contagem por idioma e grupos de versões
// (o mesmo título dublado, legendado ou em outro idioma vira um só cartão).
export function rebuildLists() {
  const D = S.data;
  if (!D) return;
  const prefs = S.settings.langPrefs || [];
  const hide = S.settings.langHideOthers && prefs.length;
  for (const kind of KINDS) {
    const list = hide ? D.all[kind].filter((i) => !i.lang || prefs.includes(i.lang)) : D.all[kind];
    D[kind] = list;
    const lc = new Map();
    for (const i of list) lc.set(i.lang || '', (lc.get(i.lang || '') || 0) + 1);
    D.langCounts[kind] = lc;
    if (kind !== 'live') D.versions[kind] = versionGroups(list);
  }
}

function versionGroups(list) {
  const by = new Map();
  for (const i of list) {
    if (!i.vkey) continue;
    const g = by.get(i.vkey);
    if (g) g.push(i); else by.set(i.vkey, [i]);
  }
  const out = new Map();
  for (const [k, g] of by) {
    if (g.length > 1 && new Set(g.map((i) => i.ver || i.lang || '')).size > 1) out.set(k, g);
  }
  return out;
}

export const versionsOf = (it) => (it?.vkey && S.data?.versions[it.kind]?.get(it.vkey)) || null;

export function applyLangSettings() { rebuildLists(); emit('langs'); }

// Nome exibido: sem o prefixo de região ("PT: SIC" -> "SIC") quando o ajuste estiver ligado.
export const displayName = (it) => (S.settings.stripLangPrefix && it.dn) || it.name;

export function refreshPlaylistMeta() {
  if (!S.pl) return;
  S.pl = S.playlists.find((p) => p.id === S.pl.id) || null;
}

// ---- URLs de reprodução ----
export function liveExt() {
  const f = S.settings.liveFormat;
  if (f === 'hls') return 'm3u8';
  if (f === 'ts') return 'ts';
  const allowed = S.pl?.account?.formats || [];
  if (!allowed.length || allowed.includes('m3u8')) return 'm3u8';
  return allowed.includes('ts') ? 'ts' : 'm3u8';
}
export function xtream() { return S.pl?.type === 'xtream' ? new Xtream(S.pl, S.net) : null; }
export function streamUrl(item) {
  if (item.url) return item.url;
  const x = xtream();
  if (!x) throw new Error('Sem endereço de reprodução');
  if (item.kind === 'live') return x.liveUrl(item.id, liveExt());
  if (item.kind === 'movie') return x.movieUrl(item.id, item.ext);
  if (item.kind === 'episode') return x.episodeUrl(item.id, item.ext);
  throw new Error('Tipo desconhecido');
}

// ---- Favoritos ----
const snapshot = (i) => ({ kind: i.kind, id: i.id, name: i.name, logo: i.logo || '', cat: i.cat, num: i.num, ext: i.ext, url: i.url, epgId: i.epgId });
export const isFav = (item) => S.favs.has(item.key || itemKey(item.pid, item.kind, item.id));
export async function toggleFav(item) {
  const key = item.key || itemKey(S.pl.id, item.kind, item.id);
  if (S.favs.has(key)) {
    S.favs.delete(key);
    await db.del('favorites', key);
    emit('favs');
    return false;
  }
  const rec = { key, pid: S.pl.id, added: Date.now(), item: snapshot(item) };
  S.favs.set(key, rec);
  await db.put('favorites', rec);
  emit('favs');
  return true;
}
export function favItems(kind) {
  const out = [];
  for (const f of S.favs.values()) {
    if (kind && f.item.kind !== kind) continue;
    out.push(S.data?.byKey.get(f.key) || { ...f.item, key: f.key, pid: f.pid });
  }
  return out.sort((a, b) => (S.favs.get(a.key)?.added || 0) - (S.favs.get(b.key)?.added || 0));
}

// ---- Histórico e progresso ----
export async function getProgress(item) {
  if (!S.pl) return null;
  return db.get('history', itemKey(S.pl.id, item.kind, item.id));
}
export async function saveHistory(item, extra = {}) {
  if (!S.pl) return;
  const key = itemKey(S.pl.id, item.kind, item.id);
  const prev = await db.get('history', key);
  const rec = {
    ...(prev || {}),
    key, pid: S.pl.id, kind: item.kind, id: item.id,
    item: { ...snapshot(item), series: item.series, season: item.season, episode: item.episode, title: item.title },
    updated: Date.now(),
    ...extra,
  };
  if (rec.dur > 0) rec.watched = rec.pos / rec.dur > 0.92;
  await db.put('history', rec);
}
export async function history(kind) {
  if (!S.pl) return [];
  const all = await db.getAll('history', 'pid', IDBKeyRange.only(S.pl.id));
  return all.filter((r) => !kind || (Array.isArray(kind) ? kind.includes(r.kind) : r.kind === kind)).sort((a, b) => b.updated - a.updated);
}

// ---- Guia (EPG) ----
export function epgKeyFor(item) {
  if (item.epgId) return item.epgId;
  return S.alias[normChannel(item.tvgName || item.name)] || '';
}
export async function epgFor(item) {
  if (!S.pl || !item) return [];
  const ch = epgKeyFor(item);
  if (!ch) return [];
  if (S.epgCache.has(ch)) return S.epgCache.get(ch);
  const rec = await db.get('epg', [S.pl.id, ch]);
  const list = rec?.progs || [];
  if (S.epgCache.size > 600) S.epgCache.delete(S.epgCache.keys().next().value);
  S.epgCache.set(ch, list);
  return list;
}

const shortCache = new Map();
// Guia curto pela API Xtream, usado quando o XMLTV não traz o canal.
export async function epgWithFallback(item) {
  const list = await epgFor(item);
  if (list.length || item.kind !== 'live') return list;
  const x = xtream();
  if (!x || !item.id) return list;
  const ck = `${S.pl.id}|${item.id}`;
  if (shortCache.has(ck)) return shortCache.get(ck);
  let out = [];
  try {
    const j = await x.shortEpg(item.id, 8);
    out = (j?.epg_listings || []).map((p) => ({
      s: Number(p.start_timestamp) * 1000 || Date.parse(`${p.start}Z`),
      e: Number(p.stop_timestamp) * 1000 || Date.parse(`${p.end}Z`),
      t: b64utf8(p.title), d: b64utf8(p.description),
    })).filter((p) => Number.isFinite(p.s));
  } catch { out = []; }
  shortCache.set(ck, out);
  return out;
}

export function nowNext(progs, t = Date.now()) {
  if (!progs?.length) return { now: null, next: null, idx: -1 };
  let lo = 0; let hi = progs.length - 1; let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (progs[mid].s <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const now = idx >= 0 && progs[idx].e > t ? progs[idx] : null;
  const next = progs[idx + 1] || null;
  return { now, next, idx };
}
