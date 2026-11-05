// Tela Buscar: canais, filmes e séries.
import { S } from './store.js';
import { h, debounce } from './ui.js';
import { norm } from './util.js';
import { add, needPlaylist, channelCard, posterCard } from './views-common.js';

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
    add(out,
      sec('Canais', live, (it) => channelCard(it, live)),
      sec('Filmes', movies, (it) => posterCard(it)),
      sec('Séries', series, (it) => posterCard(it)));
  }, 300);
  input.addEventListener('input', run);
  add(root, h('header', { class: 'page-head' }, h('h1', null, 'Buscar')), input, out);
}
