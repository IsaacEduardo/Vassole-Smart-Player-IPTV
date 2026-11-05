// Tela Buscar: canais, filmes, séries e programas do guia.
import { S, epgKeyFor, displayName } from './store.js';
import * as db from './db.js';
import { h, debounce, fmtClock, modal } from './ui.js';
import { norm } from './util.js';
import { add, needPlaylist, channelCard, posterCard, collapseVersions, collapseVariants, playLive } from './views-common.js';

// Índice dos programas do guia (de 3 h atrás até 24 h à frente), refeito quando o guia muda.
let epgIndex = null;
async function guideIndex() {
  const key = `${S.pl.id}|${S.pl.epgSync || 0}|${S.settings.epgOffset || 0}|${S.data.live.length}`;
  if (epgIndex?.key === key) return epgIndex.list;
  const byCh = new Map();
  for (const c of S.data.live) { const k = epgKeyFor(c); if (k && !byCh.has(k)) byCh.set(k, c); }
  const from = Date.now() - 3 * 3600e3;
  const to = Date.now() + 24 * 3600e3;
  const list = [];
  for (const rec of await db.getAll('epg', null, db.epgRange(S.pl.id))) {
    const ch = byCh.get(rec.ch);
    if (!ch || !rec.progs) continue;
    const shift = ((Number(ch.shift) || 0) + (Number(S.settings.epgOffset) || 0)) * 3600e3;
    for (const p of rec.progs) {
      const s = p.s + shift;
      const e = p.e + shift;
      if (e < from || s > to || !p.t) continue;
      list.push({ ch, s, e, t: p.t, d: p.d, n: norm(p.t) });
    }
  }
  list.sort((a, b) => a.s - b.s);
  epgIndex = { key, list };
  return list;
}

function programme(p) {
  const now = Date.now();
  const live = p.s <= now && p.e > now;
  const day = new Date(p.s).toDateString() === new Date().toDateString() ? 'Hoje' : 'Amanhã';
  const open = () => {
    if (live) { playLive(p.ch, [p.ch]); return; }
    const m = modal([
      h('h2', null, p.t),
      h('p', { class: 'muted' }, `${displayName(p.ch)} · ${day} · ${fmtClock(p.s)}–${fmtClock(p.e)}`),
      p.d ? h('p', null, p.d) : null,
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => m.close() }, 'Fechar'),
        h('button', { class: 'btn primary', onclick: () => { m.close(); playLive(p.ch, [p.ch]); } }, 'Abrir canal')),
    ]);
  };
  return h('button', { class: `epg-hit${live ? ' on' : ''}`, onclick: open },
    h('span', { class: 't' }, live ? `Agora · até ${fmtClock(p.e)}` : `${day} ${fmtClock(p.s)}`),
    h('span', null, h('strong', null, p.t), h('span', { class: 'muted' }, ` · ${displayName(p.ch)}`)));
}

export async function viewSearch(root) {
  if (needPlaylist(root)) return;
  const input = h('input', { class: 'input xl', type: 'search', placeholder: 'Canal, filme, série ou programa do guia', 'data-autofocus': true, 'aria-label': 'Buscar' });
  const out = h('div', { class: 'results' });
  const guide = h('div');
  let seq = 0;
  const run = debounce(async () => {
    const my = ++seq;
    const words = norm(input.value).split(' ').filter(Boolean);
    out.replaceChildren();
    guide.replaceChildren();
    if (!words.length) return;
    const match = (i) => words.every((w) => (i.n || norm(i.name)).includes(w));
    const live = collapseVariants(S.data.live.filter(match));
    const movies = collapseVersions(S.data.movie.filter(match));
    const series = collapseVersions(S.data.series.filter(match));
    const sec = (title, list, render) => (list.length ? h('section', { class: 'shelf' },
      h('h2', null, `${title} (${list.length})`), h('div', { class: 'grid', 'data-group': `res-${title}` }, list.slice(0, 60).map(render))) : null);
    add(out,
      sec('Canais', live, (it) => channelCard(it, live)),
      sec('Filmes', movies, (it) => posterCard(it)),
      sec('Séries', series, (it) => posterCard(it)));
    // Guia: programas em exibição ou nas próximas 24 h.
    if (S.pl.epgSync) {
      guide.append(h('p', { class: 'muted small' }, 'Buscando no guia…'));
      const now = Date.now();
      const hits = (await guideIndex()).filter((p) => p.e > now && words.every((w) => p.n.includes(w)));
      if (my !== seq) return;
      guide.replaceChildren(hits.length ? h('section', { class: 'shelf g-search' },
        h('h2', null, `No guia (${hits.length})`),
        h('div', { 'data-group': 'res-guia' }, hits.slice(0, 40).map(programme))) : '');
    }
    if (!live.length && !movies.length && !series.length && !guide.querySelector('.epg-hit')) out.append(h('p', { class: 'muted' }, 'Nenhum resultado.'));
  }, 300);
  input.addEventListener('input', run);
  add(root, h('header', { class: 'page-head' }, h('h1', null, 'Buscar')), input, out, guide);
}
