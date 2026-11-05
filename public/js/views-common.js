// Partes compartilhadas pelas telas: limpeza, cartões, categorias e helpers.
import { S, favItems, isFav } from './store.js';
import { h, icon, img } from './ui.js';
import * as player from './player.js';

export const cleanups = [];
export const track = (fn) => cleanups.push(fn);
export const go = (hash) => { location.hash = hash; };
// Element.append converte null em texto; este auxiliar descarta valores vazios.
export const add = (el, ...c) => el.append(...c.flat().filter((x) => x !== null && x !== undefined && x !== false));

// Estado da TV ao vivo e do guia, mantido entre visitas às telas.
export const liveState = { cat: '__all', q: '' };

export function needPlaylist(root) {
  if (S.pl && S.data) return false;
  add(root, h('div', { class: 'empty' },
    h('h1', null, S.playlists.length ? 'Nenhuma playlist ativa' : 'Bem-vindo ao Sintonia'),
    h('p', { class: 'muted' }, 'O Sintonia reproduz as suas próprias fontes: listas M3U e contas Xtream Codes fornecidas pelo seu provedor. O app não inclui canais nem conteúdo.'),
    h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => go('#/playlists/add') }, icon('plus'), 'Adicionar playlist'),
    S.playlists.length ? h('button', { class: 'btn', onclick: () => go('#/playlists') }, 'Escolher playlist') : null));
  return true;
}

export const kindLabel = { live: 'Canais', movie: 'Filmes', series: 'Séries' };

export function progressBar(rec) {
  if (!rec || !rec.dur || !rec.pos) return null;
  return h('div', { class: 'pbar' }, h('div', { style: { width: `${Math.min(100, (rec.pos / rec.dur) * 100)}%` } }));
}

export function posterCard(it, { onOpen, rec } = {}) {
  return h('button', { class: 'card poster', 'data-key': it.key, onclick: onOpen || (() => openItem(it)) },
    h('div', { class: 'thumb' }, img(it.logo, ''), isFav(it) ? h('span', { class: 'badge-fav' }, icon('star')) : null, progressBar(rec)),
    h('div', { class: 'cap' }, it.name));
}
export function channelCard(it, list) {
  return h('button', { class: 'card chan', 'data-key': it.key, onclick: () => playLive(it, list) },
    h('div', { class: 'logo' }, img(it.logo, '')),
    h('div', { class: 'cap' }, it.num ? `${it.num} · ${it.name}` : it.name));
}

export function openItem(it) {
  if (it.kind === 'movie') go(`#/movie/${encodeURIComponent(it.id)}`);
  else if (it.kind === 'series') go(`#/show/${encodeURIComponent(it.id)}`);
  else if (it.kind === 'live') playLive(it, [it]);
}
export function playLive(it, list) {
  const l = list && list.length ? list : [it];
  player.play(it, { mode: 'full', list: l, index: Math.max(0, l.findIndex((c) => c.key === it.key)) });
}

export function shelf(title, items, render) {
  if (!items.length) return null;
  return h('section', { class: 'shelf' },
    h('h2', null, title),
    h('div', { class: 'shelf-row', 'data-group': `shelf-${title}` }, items.map(render)));
}

export function catButtons(kind, state, counts, onPick, extra = []) {
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

export function liveList(cat) {
  if (cat === '__all') return S.data.live;
  if (cat === '__fav') return favItems('live');
  return S.data.live.filter((c) => c.cat === cat);
}
