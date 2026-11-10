// Estado da aplicação: ajustes, playlist ativa, favoritos, histórico e guia.
import * as db from './db.js';
import { Xtream } from './xtream.js';
import { itemKey, b64utf8, normChannel, channelQuality } from './util.js';
import { caps } from './platform.js';

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
  epgOffset: 0,           // ajuste manual do guia XMLTV, em horas
  androidPlayer: 'native',  // Android: 'native' (ExoPlayer) ou 'web' (hls.js/mpegts.js no WebView)
  chanQuality: 'high',    // canal com várias qualidades: começa pela 'high' (maior) ou 'low' (mais leve)
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
  unlocked: false,        // categorias bloqueadas liberadas pelo PIN nesta sessão
  variantChoice: new Map(), // canal com várias qualidades: a escolhida pelo usuário nesta sessão
  epgCache: new Map(),
  alias: {},
  listeners: new Set(),
};

export function onChange(fn) { S.listeners.add(fn); return () => S.listeners.delete(fn); }
export function emit(what) { for (const fn of S.listeners) fn(what); }

export async function detectProxy() {
  // Fora do navegador não há server.mjs: os apps acessam os provedores diretamente.
  if (!caps.proxy) { S.proxyAvailable = false; computeNet(); return; }
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    const j = await r.json();
    S.proxyAvailable = !!j.proxy;
    if (j.version) S.appVersion = j.version;
  } catch { S.proxyAvailable = false; }
  computeNet();
}

export function computeNet() {
  const m = S.settings.proxyMode;
  S.net = { proxy: caps.proxy && (m === 'on' || (m === 'auto' && S.proxyAvailable)), ua: S.settings.ua || '', base: location.origin };
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
    allCats: { live: byCat('live'), movie: byCat('movie'), series: byCat('series') },
    cats: {}, variants: new Map(),
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
// Preferências de categoria da playlist: ocultas, bloqueadas (PIN) e ordem.
export const catPrefs = () => S.pl?.catPrefs || { hidden: [], locked: [], order: {} };
const catSets = () => { const p = catPrefs(); return { hidden: new Set(p.hidden), locked: new Set(p.locked) }; };

// Item visível: categoria não oculta, não bloqueada (ou liberada pelo PIN) e idioma permitido.
export function isVisible(it) {
  if (!it) return false;
  const { hidden, locked } = catSets();
  const ck = `${it.kind === 'episode' ? 'series' : it.kind}|${it.cat}`;
  if (hidden.has(ck) || (!S.unlocked && locked.has(ck))) return false;
  const prefs = S.settings.langPrefs || [];
  return !(S.settings.langHideOthers && prefs.length && it.lang && !prefs.includes(it.lang));
}

export function rebuildLists() {
  const D = S.data;
  if (!D) return;
  const prefs = S.settings.langPrefs || [];
  const hideLang = S.settings.langHideOthers && prefs.length;
  const { hidden, locked } = catSets();
  const order = catPrefs().order || {};
  for (const kind of KINDS) {
    const blocked = (i) => hidden.has(`${kind}|${i.cat}`) || (!S.unlocked && locked.has(`${kind}|${i.cat}`));
    const list = D.all[kind].filter((i) => !blocked(i) && !(hideLang && i.lang && !prefs.includes(i.lang)));
    D[kind] = list;
    // Categorias: sem as ocultas, na ordem escolhida; as bloqueadas ficam marcadas.
    const pos = new Map((order[kind] || []).map((id, n) => [id, n]));
    D.cats[kind] = D.allCats[kind]
      .filter((c) => !hidden.has(`${kind}|${c.id}`))
      .map((c) => ({ ...c, locked: locked.has(`${kind}|${c.id}`) && !S.unlocked }))
      .sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e6 + a.order) - (pos.has(b.id) ? pos.get(b.id) : 1e6 + b.order));
    const lc = new Map();
    for (const i of list) lc.set(i.lang || '', (lc.get(i.lang || '') || 0) + 1);
    D.langCounts[kind] = lc;
    if (kind !== 'live') D.versions[kind] = versionGroups(list);
  }
  D.variants = variantGroups(D.live);
}

// ---- Mesmo canal em várias qualidades (SD, HD, FHD, 4K) ----
function variantGroups(list) {
  const by = new Map();
  for (const i of list) {
    const base = normChannel(i.dn || i.name);
    if (!base) continue;
    const q = channelQuality(i.name);
    i.qkey = `${i.lang || ''}|${base}`;
    i.qrank = q.rank;
    i.qlabel = q.label;
    const g = by.get(i.qkey);
    if (g) g.push(i); else by.set(i.qkey, [i]);
  }
  const out = new Map();
  for (const [k, g] of by) if (g.length > 1) out.set(k, g.sort((a, b) => b.qrank - a.qrank));
  return out;
}

export const variantsOf = (it) => (it?.qkey && S.data?.variants.get(it.qkey)) || null;
export const sameChannel = (a, b) => !!a && !!b && (a.key === b.key || (!!a.qkey && a.qkey === b.qkey && !!variantsOf(a)));

// Versão do canal a tocar: a escolhida nesta sessão ou, pelo ajuste, a de maior ou menor qualidade.
export function preferredVariant(it) {
  const g = variantsOf(it);
  if (!g) return it;
  const chosen = g.find((v) => v.key === S.variantChoice.get(it.qkey));
  if (chosen) return chosen;
  return S.settings.chanQuality === 'low' ? g[g.length - 1] : g[0];
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
const snapshot = (i) => ({ kind: i.kind, id: i.id, name: i.name, logo: i.logo || '', cat: i.cat, num: i.num, ext: i.ext, url: i.url, epgId: i.epgId, ua: i.ua, ref: i.ref, shift: i.shift });

// Rede para tocar um item: o User-Agent e o Referer do canal (listas M3U) valem sobre o ajuste geral.
export const itemNet = (it) => (it && (it.ua || it.ref) ? { ...S.net, ua: it.ua || S.net.ua, ref: it.ref || '' } : S.net);
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
    const it = S.data?.byKey.get(f.key) || { ...f.item, key: f.key, pid: f.pid };
    if (isVisible(it)) out.push(it);
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
// Programação XMLTV do canal, com o tvg-shift do canal e o ajuste manual dos Ajustes aplicados.
export async function epgFor(item) {
  if (!S.pl || !item) return [];
  const ch = epgKeyFor(item);
  if (!ch) return [];
  const shift = ((Number(item.shift) || 0) + (Number(S.settings.epgOffset) || 0)) * 3600e3;
  const ck = shift ? `${ch}|${shift}` : ch;
  if (S.epgCache.has(ck)) return S.epgCache.get(ck);
  const rec = await db.get('epg', [S.pl.id, ch]);
  let list = rec?.progs || [];
  if (shift) list = list.map((p) => ({ ...p, s: p.s + shift, e: p.e + shift }));
  if (S.epgCache.size > 600) S.epgCache.delete(S.epgCache.keys().next().value);
  S.epgCache.set(ck, list);
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
