// Leitura de playlists M3U / M3U Plus e conversão em canais, filmes e séries.
import { hash, itemKey, norm } from './util.js';
import { categoryLang, detectLang, detectVersion, versionKey } from './lang.js';

function splitInfo(s) {
  // "#EXTINF:-1 tvg-id="x" group-title="A, B",Nome do canal"
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') q = !q;
    else if (c === ',' && !q) return [s.slice(0, i), s.slice(i + 1)];
  }
  return [s, ''];
}

function attrs(s) {
  const out = {};
  const re = /([\w-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2].trim();
  return out;
}

// Cabeçalhos HTTP do canal: #EXTVLCOPT:http-user-agent=…, #EXTVLCOPT:http-referrer=…,
// #EXTHTTP:{"User-Agent":…,"Referer":…} e o formato do Kodi "url|User-Agent=…&Referer=…".
function vlcOpt(line, opts) {
  const m = /^#EXTVLCOPT:\s*http-(user-agent|referr?er)\s*=\s*(.+)$/i.exec(line);
  if (m) opts[/agent/i.test(m[1]) ? 'ua' : 'ref'] = m[2].trim();
}
function extHttp(line, opts) {
  try {
    const j = JSON.parse(line.slice(line.indexOf(':') + 1));
    for (const [k, v] of Object.entries(j)) {
      if (/^user-agent$/i.test(k)) opts.ua = String(v);
      else if (/^referr?er$/i.test(k)) opts.ref = String(v);
    }
  } catch { /* JSON inválido: ignora */ }
}
export function splitKodiUrl(raw, opts = {}) {
  const i = raw.indexOf('|');
  if (i < 0) return raw;
  for (const part of raw.slice(i + 1).split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    let v = part.slice(eq + 1).trim();
    try { v = decodeURIComponent(v); } catch { /* mantém */ }
    if (/^user-agent$/i.test(k)) opts.ua = v;
    else if (/^referr?er$/i.test(k)) opts.ref = v;
  }
  return raw.slice(0, i);
}

export function parseM3U(text) {
  const header = {};
  const entries = [];
  let cur = null;
  let opts = {};
  const lines = text.split(/\r?\n/);
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTM3U')) {
      const a = attrs(line);
      const epg = a['url-tvg'] || a['x-tvg-url'] || a['tvg-url'];
      if (epg) header.epg = epg.split(',')[0].trim();
      if (a['tvg-shift']) header.shift = Number(a['tvg-shift']) || 0;
    } else if (line.startsWith('#EXTINF')) {
      const [left, name] = splitInfo(line.slice(line.indexOf(':') + 1));
      const a = attrs(left);
      cur = {
        name: (name || a['tvg-name'] || '').trim(),
        tvgId: a['tvg-id'] || '',
        tvgName: a['tvg-name'] || '',
        logo: a['tvg-logo'] || a.logo || '',
        group: a['group-title'] || '',
        chno: a['tvg-chno'] || '',
        tvgLanguage: a['tvg-language'] || '',
        tvgCountry: a['tvg-country'] || '',
        shift: a['tvg-shift'] !== undefined ? Number(a['tvg-shift']) || 0 : null,
      };
    } else if (line.startsWith('#EXTGRP:')) {
      if (cur && !cur.group) cur.group = line.slice(8).trim();
    } else if (/^#EXTVLCOPT:/i.test(line)) {
      vlcOpt(line, opts);
    } else if (/^#EXTHTTP:/i.test(line)) {
      extHttp(line, opts);
    } else if (line.startsWith('#')) {
      continue;
    } else {
      const e = cur || { name: line, tvgId: '', tvgName: '', logo: '', group: '', chno: '', tvgLanguage: '', tvgCountry: '', shift: null };
      e.url = splitKodiUrl(line, opts);
      if (opts.ua) e.ua = opts.ua;
      if (opts.ref) e.ref = opts.ref;
      opts = {};
      if (!e.name) e.name = e.tvgName || line;
      entries.push(e);
      cur = null;
    }
  }
  return { header, entries };
}

const VOD_EXT = /\.(mp4|mkv|avi|mov|webm|m4v|wmv|flv|mpg|mpeg)(\?|$)/i;
const SXE = /^(.*?)[\s._\-–|]*\bS(\d{1,2})\s*[ ._-]?\s*E(\d{1,4})\b(.*)$/i;

export function classify(e) {
  let path = '';
  try { path = new URL(e.url).pathname; } catch { path = e.url; }
  const sxe = SXE.exec(e.name);
  if (/\/series\//i.test(path)) return sxe ? 'series' : 'movie';
  if (/\/movie\//i.test(path)) return 'movie';
  if (VOD_EXT.test(path)) return sxe ? 'series' : 'movie';
  return 'live';
}

export function buildFromM3U(pid, text) {
  const { header, entries } = parseM3U(text);
  const cats = { live: new Map(), movie: new Map(), series: new Map() };
  const items = [];
  const seen = new Map();
  const series = new Map();
  let liveNum = 0;

  const uid = (base) => {
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  };
  const cat = (kind, name) => {
    const id = name || '__none';
    if (!cats[kind].has(id)) cats[kind].set(id, { key: itemKey(pid, kind, id), pid, kind, id, name: name || 'Sem categoria', order: cats[kind].size, lang: categoryLang(name) });
    return id;
  };

  for (const e of entries) {
    const kind = classify(e);
    if (kind === 'series') {
      const m = SXE.exec(e.name);
      const sName = (m[1] || e.name).trim() || e.name;
      const sid = `m${hash(`${e.group}|${sName}`)}`;
      let s = series.get(sid);
      if (!s) {
        const c = cat('series', e.group);
        const { lang, dn } = detectLang({ name: sName, tvgLanguage: e.tvgLanguage, tvgCountry: e.tvgCountry, groupLang: cats.series.get(c).lang });
        s = { key: itemKey(pid, 'series', sid), pid, kind: 'series', id: sid, name: sName, n: norm(sName), logo: e.logo, cat: c, episodes: [], lang, ver: detectVersion(sName, e.group), vkey: versionKey(sName) };
        if (dn) s.dn = dn;
        series.set(sid, s);
      }
      const extM = /\.(\w{2,4})(\?|$)/.exec(e.url);
      s.episodes.push({
        id: `m${hash(e.url)}`,
        season: Number(m[2]),
        episode: Number(m[3]),
        title: (m[4] || '').replace(/^[\s\-–:|.]+/, '').trim() || `Episódio ${Number(m[3])}`,
        url: e.url,
        ext: extM ? extM[1] : '',
        logo: e.logo,
        ...(e.ua ? { ua: e.ua } : {}),
        ...(e.ref ? { ref: e.ref } : {}),
      });
      if (!s.logo && e.logo) s.logo = e.logo;
      continue;
    }
    const id = `m${uid(hash(`${kind}|${e.group}|${e.name}`))}`;
    const c = cat(kind, e.group);
    const { lang, dn } = detectLang({ name: e.name, tvgLanguage: e.tvgLanguage, tvgCountry: e.tvgCountry, groupLang: cats[kind].get(c).lang });
    const base = { key: itemKey(pid, kind, id), pid, kind, id, name: e.name, n: norm(e.name), logo: e.logo, cat: c, url: e.url, lang };
    if (dn) base.dn = dn;
    if (e.ua) base.ua = e.ua;
    if (e.ref) base.ref = e.ref;
    if (kind === 'movie') { base.ver = detectVersion(e.name, e.group); base.vkey = versionKey(e.name); }
    if (kind === 'live') {
      liveNum++;
      base.num = Number(e.chno) || liveNum;
      base.epgId = (e.tvgId || '').toLowerCase();
      base.tvgName = e.tvgName;
      // tvg-shift (horas) do canal ou, na falta dele, o do cabeçalho da lista.
      const shift = e.shift !== null && e.shift !== undefined ? e.shift : header.shift || 0;
      if (shift) base.shift = shift;
    }
    items.push(base);
  }
  for (const s of series.values()) {
    s.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
    items.push(s);
  }
  const categories = [...cats.live.values(), ...cats.movie.values(), ...cats.series.values()];
  return { items, categories, epgUrl: header.epg || '', counts: countKinds(items) };
}

export function countKinds(items) {
  const c = { live: 0, movie: 0, series: 0 };
  for (const i of items) c[i.kind]++;
  return c;
}
