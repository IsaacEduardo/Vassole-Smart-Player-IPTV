import { openDB } from './db.js';
import { S, loadSettings, detectProxy, loadPlaylists, activate, onChange } from './store.js';
import { h, icon, closeTopModal, toast } from './ui.js';
import { move, focusFirst, focusEl, currentScope } from './nav.js';
import * as player from './player.js';
import { cleanups } from './views-common.js';
import { viewHome } from './views-home.js';
import { viewLive } from './views-live.js';
import { viewGuide } from './views-guide.js';
import { viewVod } from './views-vod.js';
import { viewMovie, viewShow } from './views-detail.js';
import { viewSearch } from './views-search.js';
import { viewPlaylists, viewSettings, setRerender, syncAndReload, syncEpg } from './views-admin.js';

const ROUTES = {
  home: { view: viewHome, nav: 'home' },
  live: { view: viewLive, nav: 'live' },
  guide: { view: viewGuide, nav: 'guide' },
  movies: { view: (r) => viewVod(r, 'movie'), nav: 'movies' },
  series: { view: (r) => viewVod(r, 'series'), nav: 'series' },
  movie: { view: viewMovie, nav: 'movies', child: true },
  show: { view: viewShow, nav: 'series', child: true },
  search: { view: viewSearch, nav: 'search' },
  playlists: { view: viewPlaylists, nav: 'playlists' },
  settings: { view: viewSettings, nav: 'settings' },
};
const NAV = [
  ['home', 'Início', 'home'], ['live', 'TV ao vivo', 'live'], ['guide', 'Guia', 'guide'],
  ['movies', 'Filmes', 'movie'], ['series', 'Séries', 'series'], ['search', 'Buscar', 'search'],
  ['playlists', 'Playlists', 'list'], ['settings', 'Ajustes', 'gear'],
];

const viewEl = document.getElementById('view');
let depth = 0;
let renderSeq = 0;

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const name = ROUTES[parts[0]] ? parts[0] : 'home';
  return { name, args: parts.slice(1) };
}

function buildSidebar() {
  const sb = document.getElementById('sidebar');
  sb.replaceChildren(
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }), h('span', { class: 'brand-name' }, 'Sintonia')),
    h('div', { class: 'nav', 'data-group': 'sidebar' }, NAV.map(([id, label, ic]) => h('button', {
      class: 'nav-btn', 'data-nav': id, onclick: () => { location.hash = `#/${id}`; },
    }, icon(ic), h('span', null, label)))),
    h('div', { class: 'sb-foot muted small', id: 'sb-pl' }));
}
function updateSidebar(name) {
  const r = ROUTES[name];
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.nav === r.nav));
  document.getElementById('sb-pl').textContent = S.pl ? S.pl.name : '';
}

async function render() {
  const seq = ++renderSeq;
  const { name, args } = parseHash();
  while (cleanups.length) { try { cleanups.pop()(); } catch { /* */ } }
  if (player.isActive()) player.stop();
  const fresh = document.createElement('div');
  fresh.className = `view view-${name}`;
  updateSidebar(name);
  try {
    await ROUTES[name].view(fresh, args);
  } catch (e) {
    console.error(e);
    fresh.append(h('p', { class: 'err' }, `Erro ao abrir a tela: ${e.message}`));
  }
  if (seq !== renderSeq) return;
  viewEl.replaceChildren(fresh);
  viewEl.className = fresh.classList.contains('fill') ? 'fill' : '';
  viewEl.scrollTop = 0;
  if (!document.querySelector('.modal')) requestAnimationFrame(() => focusFirst(fresh) || focusFirst());
}
setRerender(() => render());

window.addEventListener('hashchange', () => { depth++; render(); });

function goBack() {
  if (closeTopModal()) return;
  const { name } = parseHash();
  const a = document.activeElement;
  // Na barra lateral, "voltar" leva ao conteúdo; no conteúdo, leva à barra lateral ou à tela anterior.
  if (ROUTES[name].child && depth > 0) { history.back(); return; }
  if (ROUTES[name].child) { location.hash = name === 'movie' ? '#/movies' : '#/series'; return; }
  if (a && !a.closest('#sidebar')) {
    focusEl(document.querySelector(`.nav-btn[data-nav="${ROUTES[name].nav}"]`));
    return;
  }
  if (name !== 'home') location.hash = '#/home';
}

const KEYCODES = { 10009: 'back', 461: 'back', 8: null, 415: 'playpause', 19: 'playpause', 10252: 'playpause', 427: 'chup', 428: 'chdown' };
function keyName(e) {
  if (KEYCODES[e.keyCode]) return KEYCODES[e.keyCode];
  switch (e.key) {
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case 'ArrowLeft': return 'left';
    case 'ArrowRight': return 'right';
    case 'Enter': return 'enter';
    case 'Escape': case 'GoBack': case 'BrowserBack': return 'back';
    case 'Backspace': return 'backspace';
    case 'MediaPlayPause': case 'MediaPlay': case 'MediaPause': return 'playpause';
    case ' ': return 'space';
    case 'PageUp': case 'ChannelUp': return 'chup';
    case 'PageDown': case 'ChannelDown': return 'chdown';
    default: return /^\d$/.test(e.key) ? e.key : null;
  }
}
const isText = (el) => el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'file'].includes(el.type)));

document.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  let k = keyName(e);
  if (!k) return;
  const typing = isText(document.activeElement);
  if (typing && (k === 'left' || k === 'right' || k === 'space' || k === 'backspace' || /^\d$/.test(k))) return;
  if (k === 'backspace') k = 'back';
  if (k === 'space') { if (player.isFull()) k = 'playpause'; else return; }
  if (typing && k === 'enter') return;

  if (player.isFull() && !document.querySelector('.modal')) {
    if (player.onKey(k)) { e.preventDefault(); return; }
  }
  if (k === 'back') { e.preventDefault(); goBack(); return; }
  if (k === 'up' || k === 'down' || k === 'left' || k === 'right') {
    e.preventDefault();
    if (!move(k) && k === 'left' && !document.querySelector('.modal') && !player.isFull()) {
      const { name } = parseHash();
      focusEl(document.querySelector(`.nav-btn[data-nav="${ROUTES[name].nav}"]`));
    }
    return;
  }
  if (k === 'enter') {
    const a = document.activeElement;
    if (a && a.matches('[data-f]') && !a.matches('button, a, input')) { e.preventDefault(); a.click(); }
    if (!a || a === document.body) { e.preventDefault(); focusFirst(currentScope()); }
  }
  if (k === 'chup' || k === 'chdown' || k === 'playpause') e.preventDefault();
});

async function autoUpdate() {
  const pl = S.pl;
  if (!pl) return;
  const hrs = Number(S.settings.autoUpdateHours) || 0;
  const ehrs = Number(S.settings.epgUpdateHours) || 0;
  if (hrs && Date.now() - (pl.lastSync || 0) > hrs * 3600e3) {
    const ok = await syncAndReload(pl.id, { quiet: true, epg: false });
    if (ok && !player.isActive() && ['home', 'playlists'].includes(parseHash().name)) render();
  }
  if (ehrs && (pl.epgUrl || pl.type === 'xtream') && Date.now() - (pl.epgSync || 0) > ehrs * 3600e3) {
    await syncEpg(pl.id, { quiet: true });
  }
}

async function boot() {
  document.addEventListener('db-blocked', () => toast('Feche as outras abas do Sintonia para concluir a atualização dos dados.', 10000));
  try {
    await openDB();
  } catch (e) {
    viewEl.append(h('p', { class: 'err' }, `Não foi possível abrir o armazenamento local: ${e.message}`));
    return;
  }
  await loadSettings();
  await detectProxy();
  await loadPlaylists();
  const pid = S.playlists.some((p) => p.id === S.settings.active) ? S.settings.active : S.playlists[0]?.id;
  if (pid) await activate(pid);
  buildSidebar();
  player.initPlayer();
  onChange((w) => { if (w === 'playlist') document.getElementById('sb-pl').textContent = S.pl ? S.pl.name : ''; });
  await render();
  if (location.protocol === 'https:' && !S.net.proxy) toast('Aviso: em https, streams http são bloqueados pelo navegador. Use o servidor local.', 7000);
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
  setTimeout(autoUpdate, 1500);
}
boot();
