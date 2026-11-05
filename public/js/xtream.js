// Cliente da API Xtream Codes (player_api.php).
import { fetchJSON } from './net.js';
import { itemKey, norm } from './util.js';

export function normalizeServer(s) {
  let v = String(s || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  try {
    const u = new URL(v);
    let path = u.pathname.replace(/\/(player_api|get|xmltv)\.php$/i, '').replace(/\/+$/, '');
    return `${u.protocol}//${u.host}${path}`;
  } catch { return v.replace(/\/+$/, ''); }
}

// Reconhece um link get.php?username=..&password=.. e devolve as credenciais Xtream.
export function xtreamFromUrl(url) {
  try {
    const u = new URL(url);
    const username = u.searchParams.get('username');
    const password = u.searchParams.get('password');
    if (username && password && /\/(get|player_api)\.php$/i.test(u.pathname)) {
      return { server: normalizeServer(url), username, password };
    }
  } catch { /* não é URL */ }
  return null;
}

export class Xtream {
  constructor(pl, net) {
    this.base = normalizeServer(pl.server);
    this.u = pl.username;
    this.p = pl.password;
    this.net = net;
  }
  apiUrl(params = {}) {
    const q = new URLSearchParams({ username: this.u, password: this.p, ...params });
    return `${this.base}/player_api.php?${q}`;
  }
  api(params) { return fetchJSON(this.apiUrl(params), this.net); }
  info() { return this.api(); }
  xmltvUrl() { return `${this.base}/xmltv.php?${new URLSearchParams({ username: this.u, password: this.p })}`; }
  liveUrl(id, ext = 'm3u8') { return `${this.base}/live/${encodeURIComponent(this.u)}/${encodeURIComponent(this.p)}/${id}.${ext}`; }
  movieUrl(id, ext = 'mp4') { return `${this.base}/movie/${encodeURIComponent(this.u)}/${encodeURIComponent(this.p)}/${id}.${ext || 'mp4'}`; }
  episodeUrl(id, ext = 'mp4') { return `${this.base}/series/${encodeURIComponent(this.u)}/${encodeURIComponent(this.p)}/${id}.${ext || 'mp4'}`; }
  vodInfo(id) { return this.api({ action: 'get_vod_info', vod_id: id }); }
  seriesInfo(id) { return this.api({ action: 'get_series_info', series_id: id }); }
  shortEpg(id, limit = 6) { return this.api({ action: 'get_short_epg', stream_id: id, limit }); }
}

const arr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
const catId = (v) => (v === null || v === undefined || v === '' ? '__none' : String(v));

export async function loadXtream(pid, pl, net, progress) {
  const x = new Xtream(pl, net);
  progress?.('Validando a conta…');
  const info = await x.info();
  if (!info || !info.user_info) throw new Error('O servidor não respondeu como uma API Xtream');
  if (String(info.user_info.auth) === '0') throw new Error('Usuário ou senha inválidos');

  progress?.('Baixando categorias…');
  const [lc, vc, sc] = await Promise.all([
    x.api({ action: 'get_live_categories' }),
    x.api({ action: 'get_vod_categories' }),
    x.api({ action: 'get_series_categories' }),
  ]);
  progress?.('Baixando canais, filmes e séries…');
  const [ls, vs, ss] = await Promise.all([
    x.api({ action: 'get_live_streams' }),
    x.api({ action: 'get_vod_streams' }),
    x.api({ action: 'get_series' }),
  ]);

  const categories = [];
  const addCats = (kind, list) => {
    arr(list).forEach((c, i) => categories.push({ key: itemKey(pid, kind, catId(c.category_id)), pid, kind, id: catId(c.category_id), name: c.category_name || 'Sem nome', order: i }));
    categories.push({ key: itemKey(pid, kind, '__none'), pid, kind, id: '__none', name: 'Sem categoria', order: 1e6 });
  };
  addCats('live', lc); addCats('movie', vc); addCats('series', sc);

  const items = [];
  for (const s of arr(ls)) {
    items.push({
      key: itemKey(pid, 'live', s.stream_id), pid, kind: 'live', id: String(s.stream_id),
      num: Number(s.num) || 0, name: s.name || '', n: norm(s.name), logo: s.stream_icon || '',
      cat: catId(s.category_id), epgId: String(s.epg_channel_id || '').toLowerCase(), archive: Number(s.tv_archive) || 0,
    });
  }
  for (const s of arr(vs)) {
    items.push({
      key: itemKey(pid, 'movie', s.stream_id), pid, kind: 'movie', id: String(s.stream_id),
      name: s.name || '', n: norm(s.name), logo: s.stream_icon || '', cat: catId(s.category_id),
      rating: Number(s.rating) || 0, added: Number(s.added) || 0, ext: s.container_extension || 'mp4',
    });
  }
  for (const s of arr(ss)) {
    items.push({
      key: itemKey(pid, 'series', s.series_id), pid, kind: 'series', id: String(s.series_id),
      name: s.name || '', n: norm(s.name), logo: s.cover || '', cat: catId(s.category_id),
      rating: Number(s.rating) || 0, added: Number(s.last_modified) || 0, plot: s.plot || '', year: s.releaseDate || s.release_date || '',
    });
  }
  const used = new Set(items.map((i) => `${i.kind}|${i.cat}`));
  const cats = categories.filter((c) => c.id !== '__none' || used.has(`${c.kind}|__none`));
  return { items, categories: cats, info };
}
