// Telas Filmes e Séries: categorias, filtro, ordenação e grade de cartazes.
import { S, favItems, history } from './store.js';
import { h, chunked, debounce, segmented } from './ui.js';
import { norm } from './util.js';
import { add, track, kindLabel, needPlaylist, catButtons, posterCard } from './views-common.js';

// Estado mantido entre visitas às telas.
const vodState = { movie: { cat: '__all', sort: 'default', q: '' }, series: { cat: '__all', sort: 'default', q: '' } };

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
