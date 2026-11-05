// Sincronização de playlists e do guia (EPG). Roda no worker; na falta dele, na página.
import * as db from './db.js';
import { buildFromM3U, countKinds } from './m3u.js';
import { loadXtream, Xtream } from './xtream.js';
import { parseXmltv } from './xmltv.js';
import { netFetch, textStream } from './net.js';
import { normChannel } from './util.js';

const EPG_PAST_MS = 12 * 3600e3;
const EPG_FUTURE_MS = 4 * 24 * 3600e3;

export async function syncPlaylist(pid, net, progress) {
  const pl = await db.get('playlists', pid);
  if (!pl) throw new Error('Playlist não encontrada');
  let result;
  if (pl.type === 'xtream') {
    result = await loadXtream(pid, pl, net, progress);
    const ui = result.info.user_info || {};
    pl.account = {
      status: ui.status || '',
      exp: Number(ui.exp_date) ? Number(ui.exp_date) * 1000 : null,
      maxConn: Number(ui.max_connections) || null,
      activeConn: Number(ui.active_cons) || 0,
      formats: Array.isArray(ui.allowed_output_formats) ? ui.allowed_output_formats : [],
      trial: String(ui.is_trial) === '1',
    };
  } else {
    let text = pl.fileText;
    if (!text) {
      progress?.('Baixando a playlist…');
      const r = await netFetch(pl.url, net);
      text = await r.text();
    }
    progress?.('Lendo a playlist…');
    if (!/#EXTINF/i.test(text)) throw new Error('O conteúdo recebido não é uma playlist M3U');
    result = buildFromM3U(pid, text);
    if (!pl.epgUrl && result.epgUrl) pl.epgUrl = result.epgUrl;
  }
  progress?.('Gravando no aparelho…');
  await db.clearPlaylistContent(pid);
  await db.putMany('categories', result.categories);
  await db.putMany('items', result.items);
  pl.counts = countKinds(result.items);
  pl.lastSync = Date.now();
  pl.error = '';
  await db.put('playlists', pl);
  return { counts: pl.counts };
}

export async function syncEpg(pid, net, progress) {
  const pl = await db.get('playlists', pid);
  if (!pl) throw new Error('Playlist não encontrada');
  const url = pl.epgUrl || (pl.type === 'xtream' ? new Xtream(pl, net).xmltvUrl() : '');
  if (!url) throw new Error('Esta playlist não tem endereço de guia (EPG)');

  const live = await db.getAll('items', 'pk', IDBKeyRange.only([pid, 'live']));
  const wanted = new Set();
  const byName = new Map();
  for (const it of live) {
    if (it.epgId) wanted.add(it.epgId);
    const n = normChannel(it.tvgName || it.name);
    if (n && !byName.has(n)) byName.set(n, it);
  }
  const alias = {};
  const progs = new Map();
  const now = Date.now();
  const from = now - EPG_PAST_MS;
  const to = now + EPG_FUTURE_MS;

  progress?.('Baixando o guia…');
  const r = await netFetch(url, net);
  const stream = await textStream(r);
  let nProg = 0;
  await parseXmltv(stream, {
    onChannel(c) {
      const id = c.id.toLowerCase();
      if (!id) return;
      for (const name of c.names) {
        const n = normChannel(name);
        if (n && byName.has(n)) { alias[n] = id; wanted.add(id); }
      }
    },
    onProgramme(p) {
      const ch = p.ch.toLowerCase();
      if (!wanted.has(ch) || p.e < from || p.s > to) return;
      let list = progs.get(ch);
      if (!list) progs.set(ch, (list = []));
      list.push({ s: p.s, e: p.e, t: p.t, d: p.d.length > 600 ? `${p.d.slice(0, 600)}…` : p.d });
      nProg++;
    },
    onProgress(bytes) { progress?.(`Lendo o guia… ${(bytes / 1e6).toFixed(0)} MB, ${nProg} programas`); },
  });

  progress?.('Gravando o guia…');
  await db.deleteWhere('epg', null, db.epgRange(pid));
  const recs = [];
  for (const [ch, list] of progs) {
    list.sort((a, b) => a.s - b.s);
    recs.push({ pid, ch, progs: list });
  }
  recs.push({ pid, ch: '\u0001alias', map: alias });
  await db.putMany('epg', recs, 500);
  pl.epgSync = Date.now();
  pl.epgCount = progs.size;
  await db.put('playlists', pl);
  return { channels: progs.size, programmes: nProg };
}
