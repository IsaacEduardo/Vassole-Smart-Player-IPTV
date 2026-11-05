// Telas do app.
import {
  S, onChange, favItems, isFav, toggleFav, history, epgFor, epgWithFallback, nowNext,
  xtream, getProgress,
} from './store.js';
import { h, icon, img, fmtClock, fmtTime, fmtDate, ago, toast, modal, chunked, debounce, segmented } from './ui.js';
import * as player from './player.js';
import { focusEl, focusFirst } from './nav.js';
import { itemKey, norm } from './util.js';
import * as db from './db.js';

export const cleanups = [];
const track = (fn) => cleanups.push(fn);
const go = (hash) => { location.hash = hash; };
// Element.append converte null em texto; este auxiliar descarta valores vazios.
const add = (el, ...c) => el.append(...c.flat().filter((x) => x !== null && x !== undefined && x !== false));

// Estado mantido entre visitas às telas.
const liveState = { cat: '__all', q: '' };
const vodState = { movie: { cat: '__all', sort: 'default', q: '' }, series: { cat: '__all', sort: 'default', q: '' } };

function needPlaylist(root) {
  if (S.pl && S.data) return false;
  add(root, h('div', { class: 'empty' },
    h('h1', null, S.playlists.length ? 'Nenhuma playlist ativa' : 'Bem-vindo ao Sintonia'),
    h('p', { class: 'muted' }, 'O Sintonia reproduz as suas próprias fontes: listas M3U e contas Xtream Codes fornecidas pelo seu provedor. O app não inclui canais nem conteúdo.'),
    h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => go('#/playlists/add') }, icon('plus'), 'Adicionar playlist'),
    S.playlists.length ? h('button', { class: 'btn', onclick: () => go('#/playlists') }, 'Escolher playlist') : null));
  return true;
}

const kindLabel = { live: 'Canais', movie: 'Filmes', series: 'Séries' };

function progressBar(rec) {
  if (!rec || !rec.dur || !rec.pos) return null;
  return h('div', { class: 'pbar' }, h('div', { style: { width: `${Math.min(100, (rec.pos / rec.dur) * 100)}%` } }));
}

function posterCard(it, { onOpen, rec } = {}) {
  return h('button', { class: 'card poster', 'data-key': it.key, onclick: onOpen || (() => openItem(it)) },
    h('div', { class: 'thumb' }, img(it.logo, ''), isFav(it) ? h('span', { class: 'badge-fav' }, icon('star')) : null, progressBar(rec)),
    h('div', { class: 'cap' }, it.name));
}
function channelCard(it, list) {
  return h('button', { class: 'card chan', 'data-key': it.key, onclick: () => playLive(it, list) },
    h('div', { class: 'logo' }, img(it.logo, '')),
    h('div', { class: 'cap' }, it.num ? `${it.num} · ${it.name}` : it.name));
}

export function openItem(it) {
  if (it.kind === 'movie') go(`#/movie/${encodeURIComponent(it.id)}`);
  else if (it.kind === 'series') go(`#/show/${encodeURIComponent(it.id)}`);
  else if (it.kind === 'live') playLive(it, [it]);
}
function playLive(it, list) {
  const l = list && list.length ? list : [it];
  player.play(it, { mode: 'full', list: l, index: Math.max(0, l.findIndex((c) => c.key === it.key)) });
}

function shelf(title, items, render) {
  if (!items.length) return null;
  return h('section', { class: 'shelf' },
    h('h2', null, title),
    h('div', { class: 'shelf-row', 'data-group': `shelf-${title}` }, items.map(render)));
}

// ---------------- Início ----------------
export async function viewHome(root) {
  if (needPlaylist(root)) return;
  const pl = S.pl;
  const hist = await history();
  const cont = hist.filter((r) => (r.kind === 'movie' || r.kind === 'episode') && !r.watched && r.pos > 0).slice(0, 24);
  const recentLive = hist.filter((r) => r.kind === 'live').slice(0, 24)
    .map((r) => S.data.byKey.get(r.key)).filter(Boolean);
  const acc = pl.account;
  const meta = [
    `${pl.counts?.live || 0} canais`, `${pl.counts?.movie || 0} filmes`, `${pl.counts?.series || 0} séries`,
    `atualizada ${ago(pl.lastSync)}`,
    acc?.exp ? `conta expira em ${fmtDate(acc.exp)}` : null,
  ].filter(Boolean).join(' · ');

  const contCard = (r) => {
    const it = r.kind === 'episode'
      ? { ...r.item, kind: 'episode', key: r.key, pid: r.pid, logo: r.item.logo || r.item.series?.logo }
      : (S.data.byKey.get(r.key) || { ...r.item, key: r.key, pid: r.pid });
    return h('button', { class: 'card wide', 'data-key': r.key, onclick: () => player.play(it, { mode: 'full', resume: true }) },
      h('div', { class: 'thumb' }, img(it.logo, ''), progressBar(r)),
      h('div', { class: 'cap' }, it.name, h('small', null, `${fmtTime(r.pos)} de ${fmtTime(r.dur)}`)));
  };

  const favLive = favItems('live');
  const favVod = [...favItems('movie'), ...favItems('series')];
  add(root, 
    h('header', { class: 'page-head' },
      h('div', null, h('h1', null, pl.name), h('p', { class: 'muted' }, meta)),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => go('#/live') }, icon('live'), 'TV ao vivo'),
        h('button', { class: 'btn', onclick: () => go('#/search') }, icon('search'), 'Buscar'))),
    shelf('Continuar assistindo', cont, contCard),
    shelf('Canais recentes', recentLive, (it) => channelCard(it, recentLive)),
    shelf('Canais favoritos', favLive, (it) => channelCard(it, favLive)),
    shelf('Filmes e séries favoritos', favVod, (it) => posterCard(it)),
    !cont.length && !recentLive.length && !favLive.length && !favVod.length
      ? h('div', { class: 'hint' }, h('p', null, 'Os canais que você assistir, os favoritos e o progresso de filmes e séries aparecem aqui.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => go('#/live') }, 'Abrir TV ao vivo'),
          h('button', { class: 'btn', onclick: () => go('#/movies') }, 'Filmes'),
          h('button', { class: 'btn', onclick: () => go('#/series') }, 'Séries')))
      : null,
  );
  const first = root.querySelector('.shelf .card');
  if (first) first.setAttribute('data-autofocus', '');
}

// ---------------- TV ao vivo ----------------
function catButtons(kind, state, counts, onPick, extra = []) {
  const D = S.data;
  const all = [
    { id: '__all', name: 'Todos', n: D[kind].length },
    { id: '__fav', name: 'Favoritos', n: favItems(kind).length },
    ...extra,
    ...D.cats[kind].map((c) => ({ id: c.id, name: c.name, n: counts.get(c.id) || 0 })).filter((c) => c.n > 0),
  ];
  return all.map((c) => h('button', {
    class: `cat${state.cat === c.id ? ' on' : ''}`, 'data-cat': c.id,
    onclick: (e) => { onPick(c.id, e.currentTarget); },
  }, h('span', { class: 'cat-name' }, c.name), h('span', { class: 'cat-n' }, String(c.n))));
}

function liveList(cat) {
  if (cat === '__all') return S.data.live;
  if (cat === '__fav') return favItems('live');
  return S.data.live.filter((c) => c.cat === cat);
}

export async function viewLive(root) {
  if (needPlaylist(root)) return;
  root.classList.add('fill');
  const preview = h('div', { class: 'preview' }, h('div', { class: 'preview-ph' }, icon('live'), h('span', null, 'Escolha um canal')));
  const info = h('div', { class: 'ch-info' });
  const chList = h('div', { class: 'ch-list', 'data-group': 'chs' });
  const cats = h('div', { class: 'cat-list', 'data-group': 'cats' });
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Filtrar canais', value: liveState.q, 'aria-label': 'Filtrar canais' });
  let current = [];
  let lister = null;

  const renderCats = () => cats.replaceChildren(...catButtons('live', liveState, S.data.counts.live, (id, btn) => {
    liveState.cat = id;
    cats.querySelectorAll('.cat').forEach((b) => b.classList.toggle('on', b === btn));
    renderChannels();
  }));

  function row(ch, i) {
    const now = h('div', { class: 'ch-now' });
    const bar = h('div', { class: 'ch-bar' }, h('div'));
    const playing = player.current()?.key === ch.key;
    const el = h('button', {
      class: `ch-row${playing ? ' playing' : ''}`, 'data-key': ch.key,
      onclick: () => {
        if (player.isActive() && player.current()?.key === ch.key) player.toFull();
        else player.play(ch, { mode: 'preview', mount: preview, list: current, index: i });
      },
      ondblclick: () => player.toFull(),
      onfocus: () => showInfoSoon(ch),
    },
    h('span', { class: 'ch-num' }, ch.num ? String(ch.num) : ''),
    h('span', { class: 'ch-logo' }, img(ch.logo, '')),
    h('span', { class: 'ch-main' }, h('span', { class: 'ch-name' }, ch.name), now, bar),
    isFav(ch) ? h('span', { class: 'ch-fav' }, icon('star')) : null);
    epgFor(ch).then((progs) => {
      const { now: p } = nowNext(progs);
      if (!p) { bar.hidden = true; return; }
      now.textContent = p.t;
      bar.firstChild.style.width = `${((Date.now() - p.s) / (p.e - p.s)) * 100}%`;
    });
    return el;
  }

  function renderChannels() {
    lister?.destroy();
    chList.replaceChildren();
    const words = norm(liveState.q).split(' ').filter(Boolean);
    current = liveList(liveState.cat).filter((c) => words.every((w) => (c.n || norm(c.name)).includes(w)));
    if (!current.length) { chList.append(h('p', { class: 'muted pad' }, liveState.cat === '__fav' ? 'Nenhum canal favorito. Use o botão de estrela durante a reprodução ou no painel ao lado.' : 'Nenhum canal.')); return; }
    lister = chunked(chList, current, row, { root: chList.parentElement });
  }

  let infoItem = null;
  const showInfoSoon = debounce((ch) => showInfo(ch), 200);
  async function showInfo(ch) {
    infoItem = ch;
    const favBtn = h('button', { class: `btn sm${isFav(ch) ? ' on' : ''}`, onclick: async () => {
      const on = await toggleFav(ch);
      favBtn.classList.toggle('on', on);
      favBtn.lastChild.textContent = on ? 'Favorito' : 'Favoritar';
      chList.querySelector(`[data-key="${CSS.escape(ch.key)}"]`)?.replaceWith(row(ch, current.indexOf(ch)));
    } }, icon('star'), h('span', null, isFav(ch) ? 'Favorito' : 'Favoritar'));
    info.replaceChildren(
      h('div', { class: 'ch-info-head' }, h('div', { class: 'ch-logo lg' }, img(ch.logo, '')),
        h('div', null, h('h2', null, ch.name), h('div', { class: 'muted' }, ch.num ? `Canal ${ch.num}` : ''))),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm primary', onclick: () => {
          if (player.current()?.key === ch.key) player.toFull();
          else player.play(ch, { mode: 'full', mount: preview, list: current, index: current.indexOf(ch) });
        } }, icon('full'), 'Tela cheia'), favBtn),
      h('div', { class: 'epg-list muted' }, 'Carregando guia…'));
    const progs = await epgWithFallback(ch);
    if (infoItem !== ch) return;
    const list = info.querySelector('.epg-list');
    const t = Date.now();
    const { idx } = nowNext(progs, t);
    const shown = progs.slice(Math.max(0, idx), Math.max(0, idx) + 12);
    if (!shown.length) { list.textContent = 'Sem informação de guia para este canal.'; return; }
    list.classList.remove('muted');
    list.replaceChildren(...shown.map((p) => {
      const on = p.s <= t && p.e > t;
      return h('div', { class: `epg-item${on ? ' on' : ''}` },
        h('div', { class: 'epg-time' }, `${fmtClock(p.s)}–${fmtClock(p.e)}`),
        h('div', null, h('div', { class: 'epg-title' }, p.t),
          on && p.d ? h('div', { class: 'epg-desc' }, p.d) : null,
          on ? h('div', { class: 'ch-bar' }, h('div', { style: { width: `${((t - p.s) / (p.e - p.s)) * 100}%` } })) : null));
    }));
  }

  q.addEventListener('input', debounce(() => { liveState.q = q.value; renderChannels(); }, 250));

  add(root, h('div', { class: 'live' },
    h('aside', { class: 'col' }, h('h2', { class: 'col-title' }, 'Categorias'), cats),
    h('section', { class: 'col' }, h('div', { class: 'col-title row' }, h('h2', null, 'Canais'), q), chList),
    h('aside', { class: 'col side' }, preview, info)));
  renderCats();
  renderChannels();

  const cur = player.current();
  if (cur?.kind === 'live' && player.isActive()) {
    player.play(cur, { mode: 'preview', mount: preview, list: current, index: current.findIndex((c) => c.key === cur.key) });
  }
  const off = onChange((what) => {
    if (what !== 'player-item') return;
    const k = player.current()?.key;
    chList.querySelectorAll('.ch-row.playing').forEach((r) => r.classList.remove('playing'));
    if (k) {
      const r = chList.querySelector(`[data-key="${CSS.escape(k)}"]`);
      if (r) { r.classList.add('playing'); if (!player.isFull()) focusEl(r); }
    }
  });
  track(off);
  track(() => lister?.destroy());
  const target = (cur && chList.querySelector(`[data-key="${CSS.escape(cur.key)}"]`)) || chList.querySelector('.ch-row');
  if (target) { target.setAttribute('data-autofocus', ''); showInfo(current.find((c) => c.key === target.dataset.key)); }
}

// ---------------- Guia de programação ----------------
const PX_MIN = 6;
const SLOT = 30 * 60000;
export async function viewGuide(root) {
  if (needPlaylist(root)) return;
  root.classList.add('fill');
  const start = Math.floor(Date.now() / SLOT) * SLOT - SLOT;
  const span = 6 * 3600e3;
  const width = (span / 60000) * PX_MIN;
  const cats = h('div', { class: 'chips', 'data-group': 'gcats' });
  const rows = h('div', { class: 'g-rows' });
  const scroller = h('div', { class: 'g-scroll' });
  let lister = null;

  const times = [];
  for (let t = start; t < start + span; t += SLOT) times.push(h('div', { class: 'g-time', style: { left: `${((t - start) / 60000) * PX_MIN}px` } }, fmtClock(t)));
  const nowLine = h('div', { class: 'g-nowline', style: { left: `calc(var(--gch) + ${((Date.now() - start) / 60000) * PX_MIN}px)` } });

  function renderCats() {
    cats.replaceChildren(...catButtons('live', liveState, S.data.counts.live, (id, btn) => {
      liveState.cat = id;
      cats.querySelectorAll('.cat').forEach((b) => b.classList.toggle('on', b === btn));
      renderRows();
    }));
  }

  function programmeInfo(ch, p, list) {
    const live = p.s <= Date.now() && p.e > Date.now();
    const m = modal([
      h('h2', null, p.t || 'Sem título'),
      h('p', { class: 'muted' }, `${ch.name} · ${new Date(p.s).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })} · ${fmtClock(p.s)}–${fmtClock(p.e)}`),
      p.d ? h('p', null, p.d) : null,
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => m.close() }, 'Fechar'),
        h('button', { class: 'btn primary', onclick: () => { m.close(); playLive(ch, list); } }, live ? 'Assistir agora' : 'Abrir canal')),
    ]);
  }

  function row(ch, i, list) {
    const progs = h('div', { class: 'g-progs', style: { width: `${width}px` } });
    const el = h('div', { class: 'g-row' },
      h('button', { class: 'g-ch', 'data-key': ch.key, onclick: () => playLive(ch, list) },
        h('span', { class: 'ch-logo' }, img(ch.logo, '')), h('span', { class: 'g-chname' }, ch.num ? `${ch.num} ${ch.name}` : ch.name)),
      progs);
    epgFor(ch).then((all) => {
      const vis = all.filter((p) => p.e > start && p.s < start + span);
      if (!vis.length) { progs.append(h('div', { class: 'g-none' }, 'Sem guia')); return; }
      const t = Date.now();
      progs.append(...vis.map((p) => {
        const l = Math.max(0, (p.s - start) / 60000) * PX_MIN;
        const r = Math.min(span, p.e - start) / 60000 * PX_MIN;
        return h('button', {
          class: `g-prog${p.s <= t && p.e > t ? ' on' : ''}`,
          style: { left: `${l}px`, width: `${Math.max(8, r - l - 3)}px` },
          title: `${fmtClock(p.s)} ${p.t}`,
          onclick: () => programmeInfo(ch, p, list),
        }, h('span', { class: 'g-pt' }, p.t), h('span', { class: 'g-ps' }, fmtClock(p.s)));
      }));
    });
    return el;
  }

  function renderRows() {
    lister?.destroy();
    rows.replaceChildren();
    const list = liveList(liveState.cat);
    if (!list.length) { rows.append(h('p', { class: 'muted pad' }, 'Nenhum canal nesta categoria.')); return; }
    lister = chunked(rows, list, (ch, i) => row(ch, i, list), { size: 40, root: scroller });
  }

  scroller.append(h('div', { class: 'g-inner', style: { width: `calc(var(--gch) + ${width}px)` } },
    h('div', { class: 'g-head' }, h('div', { class: 'g-corner' }, 'Hoje'), h('div', { class: 'g-times', style: { width: `${width}px` } }, times)),
    rows, nowLine));
  add(root, h('div', { class: 'guide' },
    h('header', { class: 'page-head tight' }, h('h1', null, 'Guia de programação'),
      h('p', { class: 'muted' }, S.pl.epgSync ? `Guia atualizado ${ago(S.pl.epgSync)} · ${S.pl.epgCount || 0} canais com programação` : 'Guia ainda não carregado. Atualize em Playlists.')),
    cats, scroller));
  renderCats();
  renderRows();
  requestAnimationFrame(() => { scroller.scrollLeft = Math.max(0, ((Date.now() - start) / 60000) * PX_MIN - 120); });
  track(() => lister?.destroy());
  const first = rows.querySelector('.g-ch');
  if (first) first.setAttribute('data-autofocus', '');
}

// ---------------- Filmes e séries ----------------
const SORTS = [
  { value: 'default', label: 'Padrão' }, { value: 'az', label: 'A–Z' },
  { value: 'recent', label: 'Recentes' }, { value: 'rating', label: 'Nota' },
];
export async function viewVod(root, kind) {
  if (needPlaylist(root)) return;
  root.classList.add('fill');
  const st = vodState[kind];
  const grid = h('div', { class: 'grid', 'data-group': `grid-${kind}` });
  const cats = h('div', { class: 'cat-list', 'data-group': `cats-${kind}` });
  const scroller = h('section', { class: 'col' });
  const q = h('input', { class: 'input', type: 'search', placeholder: `Filtrar ${kindLabel[kind].toLowerCase()}`, value: st.q, 'aria-label': 'Filtrar' });
  let lister = null;
  const hist = new Map((await history(kind === 'movie' ? 'movie' : null)).map((r) => [r.key, r]));
  const extra = kind === 'movie'
    ? [{ id: '__cont', name: 'Continuar', n: [...hist.values()].filter((r) => r.kind === 'movie' && !r.watched && r.pos > 0).length }]
    : [];

  function list() {
    const D = S.data;
    let l;
    if (st.cat === '__all') l = D[kind];
    else if (st.cat === '__fav') l = favItems(kind);
    else if (st.cat === '__cont') l = [...hist.values()].filter((r) => r.kind === 'movie' && !r.watched && r.pos > 0).map((r) => D.byKey.get(r.key)).filter(Boolean);
    else l = D[kind].filter((i) => i.cat === st.cat);
    const words = norm(st.q).split(' ').filter(Boolean);
    if (words.length) l = l.filter((i) => words.every((w) => (i.n || norm(i.name)).includes(w)));
    if (st.sort === 'az') l = [...l].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    else if (st.sort === 'recent') l = [...l].sort((a, b) => (b.added || 0) - (a.added || 0));
    else if (st.sort === 'rating') l = [...l].sort((a, b) => (b.rating || 0) - (a.rating || 0));
    return l;
  }
  function renderGrid() {
    lister?.destroy();
    grid.replaceChildren();
    const l = list();
    if (!l.length) { grid.append(h('p', { class: 'muted pad' }, 'Nada encontrado.')); return; }
    lister = chunked(grid, l, (it) => posterCard(it, { rec: hist.get(it.key) }), { size: 60, root: scroller });
  }
  cats.replaceChildren(...catButtons(kind, st, S.data.counts[kind], (id, btn) => {
    st.cat = id;
    cats.querySelectorAll('.cat').forEach((b) => b.classList.toggle('on', b === btn));
    renderGrid();
  }, extra));
  q.addEventListener('input', debounce(() => { st.q = q.value; renderGrid(); }, 250));
  scroller.append(h('div', { class: 'col-title row wrap' }, h('h2', null, kindLabel[kind]), q,
    segmented(SORTS, st.sort, (v) => { st.sort = v; renderGrid(); })), grid);
  add(root, h('div', { class: 'vod' }, h('aside', { class: 'col' }, h('h2', { class: 'col-title' }, 'Categorias'), cats), scroller));
  renderGrid();
  track(() => lister?.destroy());
  const first = grid.querySelector('.card');
  if (first) first.setAttribute('data-autofocus', '');
}

function detailShell(it, extraInfo) {
  return h('div', { class: 'detail' },
    h('div', { class: 'detail-bg' }, extraInfo?.backdrop ? img(extraInfo.backdrop, '') : null),
    h('div', { class: 'detail-main' }, h('div', { class: 'detail-poster' }, img(it.logo, '')), h('div', { class: 'detail-body' })));
}

function metaLine(parts) { return h('div', { class: 'meta' }, parts.filter(Boolean).map((p) => h('span', null, p))); }

export async function viewMovie(root, [id]) {
  if (needPlaylist(root)) return;
  const it = S.data.byKey.get(itemKey(S.pl.id, 'movie', id));
  if (!it) { add(root, h('p', { class: 'muted' }, 'Filme não encontrado nesta playlist.')); return; }
  const shell = detailShell(it);
  add(root, shell);
  const body = shell.querySelector('.detail-body');
  const rec = await getProgress(it);
  const favBtn = h('button', { class: `btn${isFav(it) ? ' on' : ''}`, onclick: async () => {
    const on = await toggleFav(it);
    favBtn.classList.toggle('on', on);
    favBtn.lastChild.textContent = on ? 'Nos favoritos' : 'Favoritar';
  } }, icon('star'), h('span', null, isFav(it) ? 'Nos favoritos' : 'Favoritar'));
  const resumable = rec && rec.pos > 30 && !rec.watched;
  const plot = h('p', { class: 'plot' });
  const meta = h('div');
  add(body, h('h1', null, it.name), meta,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => player.play(it, { mode: 'full', resume: resumable ? true : false }) },
        icon('play'), resumable ? `Retomar de ${fmtTime(rec.pos)}` : 'Assistir'),
      resumable ? h('button', { class: 'btn', onclick: () => player.play(it, { mode: 'full', resume: false }) }, 'Do início') : null,
      favBtn),
    resumable ? progressBar(rec) : null,
    plot);
  focusFirst(body);
  const x = xtream();
  if (!x) return;
  try {
    const j = await x.vodInfo(it.id);
    const i = j?.info || {};
    if (j?.movie_data?.container_extension) it.ext = j.movie_data.container_extension;
    meta.replaceWith(metaLine([
      (i.releasedate || i.release_date || '').slice(0, 4), i.duration, i.genre,
      Number(i.rating) ? `Nota ${Number(i.rating).toFixed(1)}` : null,
    ]));
    plot.textContent = i.plot || i.description || '';
    if (i.cast || i.actors) add(body, h('p', { class: 'muted small' }, `Elenco: ${i.cast || i.actors}`));
    if (i.director) add(body, h('p', { class: 'muted small' }, `Direção: ${i.director}`));
    const bd = Array.isArray(i.backdrop_path) ? i.backdrop_path[0] : i.backdrop_path;
    if (bd) shell.querySelector('.detail-bg').replaceChildren(img(bd, ''));
  } catch { /* detalhes são opcionais */ }
}

function episodeItem(series, e, season) {
  const pid = S.pl.id;
  const num = Number(e.episode_num ?? e.episode) || 0;
  const raw = e.title || '';
  const title = raw.replace(/^.*?S\d+\s*E\d+\s*[-–:|]?\s*/i, '').trim() || raw || `Episódio ${num}`;
  return {
    kind: 'episode', pid, id: String(e.id), key: itemKey(pid, 'episode', e.id),
    name: `${series.name} T${season} E${num} · ${title}`,
    title, season: Number(season), episode: num, ext: e.container_extension || e.ext || 'mp4', url: e.url,
    logo: e.info?.movie_image || e.logo || series.logo, plot: e.info?.plot || '', dur: e.info?.duration || '',
    series: { id: series.id, name: series.name, logo: series.logo },
  };
}

export async function viewShow(root, [id]) {
  if (needPlaylist(root)) return;
  const it = S.data.byKey.get(itemKey(S.pl.id, 'series', id));
  if (!it) { add(root, h('p', { class: 'muted' }, 'Série não encontrada nesta playlist.')); return; }
  const shell = detailShell(it);
  add(root, shell);
  const body = shell.querySelector('.detail-body');
  const favBtn = h('button', { class: `btn${isFav(it) ? ' on' : ''}`, onclick: async () => {
    const on = await toggleFav(it);
    favBtn.classList.toggle('on', on);
    favBtn.lastChild.textContent = on ? 'Nos favoritos' : 'Favoritar';
  } }, icon('star'), h('span', null, isFav(it) ? 'Nos favoritos' : 'Favoritar'));
  const playBtn = h('button', { class: 'btn primary', 'data-autofocus': true, disabled: true }, icon('play'), 'Carregando…');
  const meta = h('div');
  const plot = h('p', { class: 'plot' }, it.plot || '');
  const seasonsEl = h('div', { class: 'seasons', 'data-group': 'seasons' });
  const epsEl = h('div', { class: 'eps', 'data-group': 'eps' });
  add(body, h('h1', null, it.name), meta, h('div', { class: 'row' }, playBtn, favBtn), plot, seasonsEl, epsEl);
  focusFirst(body);

  let bySeason = new Map();
  try {
    if (it.episodes) {
      for (const e of it.episodes) {
        if (!bySeason.has(e.season)) bySeason.set(e.season, []);
        bySeason.get(e.season).push(episodeItem(it, e, e.season));
      }
    } else {
      const j = await xtream().seriesInfo(it.id);
      const i = j?.info || {};
      meta.replaceWith(metaLine([(i.releaseDate || i.release_date || it.year || '').slice(0, 4), i.genre, Number(i.rating) ? `Nota ${Number(i.rating).toFixed(1)}` : null]));
      if (i.plot) plot.textContent = i.plot;
      const bd = Array.isArray(i.backdrop_path) ? i.backdrop_path[0] : i.backdrop_path;
      if (bd) shell.querySelector('.detail-bg').replaceChildren(img(bd, ''));
      const eps = j?.episodes || {};
      for (const s of Object.keys(eps).sort((a, b) => Number(a) - Number(b))) {
        const arr = Array.isArray(eps[s]) ? eps[s] : Object.values(eps[s]);
        bySeason.set(Number(s), arr.map((e) => episodeItem(it, e, e.season ?? s)).sort((a, b) => a.episode - b.episode));
      }
    }
  } catch (e) {
    epsEl.append(h('p', { class: 'muted' }, `Não foi possível carregar os episódios: ${e.message}`));
    playBtn.lastChild.textContent = 'Indisponível';
    return;
  }
  bySeason = new Map([...bySeason.entries()].sort((a, b) => a[0] - b[0]));
  const flat = [...bySeason.values()].flat();
  if (!flat.length) { epsEl.append(h('p', { class: 'muted' }, 'Nenhum episódio.')); playBtn.lastChild.textContent = 'Indisponível'; return; }

  let hist = new Map();
  let season = [...bySeason.keys()][0];
  async function loadHist() { hist = new Map((await history('episode')).filter((r) => r.item?.series?.id === it.id).map((r) => [r.key, r])); }

  function nextUp() {
    const last = [...hist.values()].sort((a, b) => b.updated - a.updated)[0];
    if (!last) return { ep: flat[0], resume: false };
    const i = flat.findIndex((e) => e.key === last.key);
    if (i > -1 && !last.watched) return { ep: flat[i], resume: true, rec: last };
    if (i > -1 && flat[i + 1]) return { ep: flat[i + 1], resume: false };
    return { ep: flat[0], resume: false };
  }
  function renderPlay() {
    const n = nextUp();
    playBtn.disabled = false;
    playBtn.lastChild.textContent = n.resume ? `Retomar T${n.ep.season} E${n.ep.episode}` : `Assistir T${n.ep.season} E${n.ep.episode}`;
    playBtn.onclick = () => player.play(n.ep, { mode: 'full', list: flat, index: flat.indexOf(n.ep), resume: n.resume });
  }
  function renderSeasons() {
    seasonsEl.replaceChildren(...[...bySeason.keys()].map((s) => h('button', {
      class: `chip${s === season ? ' on' : ''}`, onclick: () => { season = s; renderSeasons(); renderEps(); },
    }, `Temporada ${s}`)));
  }
  function renderEps() {
    epsEl.replaceChildren(...bySeason.get(season).map((ep) => {
      const r = hist.get(ep.key);
      return h('button', { class: 'ep', 'data-key': ep.key, onclick: () => player.play(ep, { mode: 'full', list: flat, index: flat.indexOf(ep) }) },
        h('div', { class: 'ep-thumb' }, img(ep.logo, ''), progressBar(r)),
        h('div', { class: 'ep-body' },
          h('div', { class: 'ep-title' }, `${ep.episode}. ${ep.title}`, r?.watched ? h('span', { class: 'tag ok' }, 'Visto') : null),
          ep.plot ? h('div', { class: 'ep-plot' }, ep.plot) : null,
          ep.dur ? h('div', { class: 'muted small' }, ep.dur) : null));
    }));
  }
  await loadHist();
  renderPlay(); renderSeasons(); renderEps();
  const off = onChange(async (what) => {
    if (what !== 'player-item' || player.isActive()) return;
    await loadHist(); renderPlay(); renderEps();
  });
  track(off);
}

// ---------------- Busca ----------------
export async function viewSearch(root) {
  if (needPlaylist(root)) return;
  const input = h('input', { class: 'input xl', type: 'search', placeholder: 'Nome do canal, filme ou série', 'data-autofocus': true, 'aria-label': 'Buscar' });
  const out = h('div', { class: 'results' });
  const run = debounce(() => {
    const words = norm(input.value).split(' ').filter(Boolean);
    out.replaceChildren();
    if (!words.length) return;
    const match = (i) => words.every((w) => (i.n || norm(i.name)).includes(w));
    const live = S.data.live.filter(match);
    const movies = S.data.movie.filter(match);
    const series = S.data.series.filter(match);
    if (!live.length && !movies.length && !series.length) { out.append(h('p', { class: 'muted' }, 'Nenhum resultado.')); return; }
    const sec = (title, list, render) => (list.length ? h('section', { class: 'shelf' },
      h('h2', null, `${title} (${list.length})`), h('div', { class: 'grid', 'data-group': `res-${title}` }, list.slice(0, 60).map(render))) : null);
    out.append(
      sec('Canais', live, (it) => channelCard(it, live)),
      sec('Filmes', movies, (it) => posterCard(it)),
      sec('Séries', series, (it) => posterCard(it)));
  }, 300);
  input.addEventListener('input', run);
  add(root, h('header', { class: 'page-head' }, h('h1', null, 'Buscar')), input, out);
}

// ---------------- Leitura de backup ----------------
export async function exportBackup() {
  const [playlists, favorites, hist, settings] = await Promise.all([db.getAll('playlists'), db.getAll('favorites'), db.getAll('history'), db.getAll('settings')]);
  const data = { app: 'sintonia', version: 1, exported: new Date().toISOString(), playlists: playlists.map(({ fileText, ...p }) => ({ ...p, fileText: fileText && fileText.length < 5e6 ? fileText : undefined })), favorites, history: hist, settings };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `sintonia-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.add(body, a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
