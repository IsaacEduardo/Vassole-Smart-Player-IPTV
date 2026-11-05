// Partes compartilhadas pelas telas: limpeza, cartões, categorias, idiomas e versões.
import { S, favItems, isFav, displayName, versionsOf, variantsOf } from './store.js';
import { h, icon, img, choose } from './ui.js';
import * as player from './player.js';
import { langName, VERSION_NAMES } from './lang.js';
import { unlock } from './pin.js';
import { organizeCategories } from './views-cats.js';

export const cleanups = [];
export const track = (fn) => cleanups.push(fn);
export const go = (hash) => { location.hash = hash; };
// Element.append converte null em texto; este auxiliar descarta valores vazios.
// Redesenha a tela atual (ex.: depois de liberar categorias com o PIN).
export const rerenderView = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
export const add = (el, ...c) => el.append(...c.flat().filter((x) => x !== null && x !== undefined && x !== false));

// Estado da TV ao vivo e do guia, mantido entre visitas às telas.
export const liveState = { cat: '__all', q: '', lang: '__all' };

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

// ---- Versões (dublado, legendado, outro idioma) ----
const SHORT = { dub: 'DUB', leg: 'LEG', dual: 'DUAL' };
const shortLabel = (i) => SHORT[i.ver] || (i.lang ? i.lang.toUpperCase() : '');
export const versionLabel = (i) => VERSION_NAMES[i.ver] || langName(i.lang) || 'Versão padrão';

// Primeira ocorrência de cada grupo de versões; os demais itens do grupo somem da lista.
export function collapseVersions(list) {
  const seen = new Set();
  const out = [];
  for (const it of list) {
    if (versionsOf(it)) {
      if (seen.has(it.vkey)) continue;
      seen.add(it.vkey);
    }
    out.push(it);
  }
  return out;
}

export function posterCard(it, { onOpen, rec } = {}) {
  const vers = versionsOf(it);
  const tags = vers ? [...new Set(vers.map(shortLabel).filter(Boolean))] : [];
  return h('button', { class: 'card poster', 'data-key': it.key, onclick: onOpen || (() => openItem(it)) },
    h('div', { class: 'thumb' }, img(it.logo, ''), isFav(it) ? h('span', { class: 'badge-fav' }, icon('star')) : null,
      tags.length ? h('span', { class: 'badge-ver' }, tags.join(' · ')) : null, progressBar(rec)),
    h('div', { class: 'cap' }, displayName(it)));
}
export function channelCard(it, list) {
  return h('button', { class: 'card chan', 'data-key': it.key, onclick: () => playLive(it, list) },
    h('div', { class: 'logo' }, img(it.logo, '')),
    h('div', { class: 'cap' }, it.num ? `${it.num} · ${displayName(it)}` : displayName(it)));
}

const catName = (it) => S.data.allCats[it.kind]?.find((c) => c.id === it.cat)?.name || '';

// Abre o item; se houver várias versões do título, pergunta qual antes.
export async function openItem(it) {
  let target = it;
  const vers = versionsOf(it);
  if (vers) {
    const prefs = S.settings.langPrefs || [];
    const rank = (i) => { const r = prefs.indexOf(i.lang); return r < 0 ? 99 : r; };
    const sorted = [...vers].sort((a, b) => rank(a) - rank(b));
    const v = await choose(`${displayName(it)}: escolha a versão`, sorted.map((i, n) => ({
      label: [versionLabel(i), catName(i)].filter(Boolean).join(' · '), value: n, active: i === it,
    })));
    if (v === undefined) return;
    target = sorted[v];
  }
  if (target.kind === 'movie') go(`#/movie/${encodeURIComponent(target.id)}`);
  else if (target.kind === 'series') go(`#/show/${encodeURIComponent(target.id)}`);
  else if (target.kind === 'live') playLive(target, [target]);
}
// Na tela de detalhe: as outras versões do título, para trocar com um clique.
export function versionsRow(it) {
  const vers = versionsOf(it);
  if (!vers) return null;
  const path = it.kind === 'movie' ? 'movie' : 'show';
  return h('div', { class: 'versions', 'data-group': 'versions' },
    h('span', { class: 'muted small' }, 'Versões:'),
    vers.map((v) => h('button', {
      class: `chip${v === it ? ' on' : ''}`, onclick: () => { if (v !== it) go(`#/${path}/${encodeURIComponent(v.id)}`); },
    }, [versionLabel(v), catName(v)].filter(Boolean).join(' · '))));
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

// ---- Idiomas ----
// Filtra pela escolha de idioma da tela ('__all' = todos; '' = sem idioma identificado).
export function byLang(list, lang) {
  if (lang === undefined || lang === null || lang === '__all') return list;
  return list.filter((i) => (i.lang || '') === lang);
}

// Volta para "Todos" se o idioma escolhido não existe na playlist ativa (ex.: depois de trocar de playlist).
// O mesmo vale para a categoria escolhida (que pode ter sido ocultada ou ser de outra playlist).
export function checkLang(kind, state) {
  if (state.lang !== '__all' && !S.data.langCounts[kind]?.has(state.lang)) { state.lang = '__all'; state.cat = '__all'; }
  if (!state.cat.startsWith('__') && !S.data.cats[kind]?.some((c) => c.id === state.cat)) state.cat = '__all';
}

const langLabel = (l) => (l ? langName(l) || l.toUpperCase() : 'Sem idioma');

// Fileira de idiomas: Todos, os preferidos e os mais frequentes; os demais em "Mais idiomas…".
export function langBar(kind, state, onPick) {
  const counts = S.data.langCounts[kind];
  if (!counts || counts.size < 2) return null;
  const prefs = S.settings.langPrefs || [];
  const rank = (l) => (l === '' ? 1000 : prefs.includes(l) ? prefs.indexOf(l) : 100);
  const ordered = [...counts.keys()].sort((a, b) => rank(a) - rank(b) || counts.get(b) - counts.get(a));
  const shown = ordered.slice(0, Math.max(4, prefs.length));
  if (state.lang !== '__all' && !shown.includes(state.lang) && counts.has(state.lang)) shown.push(state.lang);
  const chip = (value, label, n) => h('button', {
    class: `chip${state.lang === value ? ' on' : ''}`, 'data-lang': value, onclick: () => onPick(value),
  }, label, h('span', { class: 'chip-n' }, String(n)));
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const more = ordered.length > shown.length ? h('button', {
    class: 'chip', onclick: async () => {
      const v = await choose('Idioma', [{ label: `Todos (${total})`, value: '__all', active: state.lang === '__all' },
        ...ordered.map((l) => ({ label: `${langLabel(l)} (${counts.get(l)})`, value: l, active: state.lang === l }))]);
      if (v !== undefined) onPick(v);
    },
  }, 'Mais idiomas…') : null;
  return h('div', { class: 'chips lang-bar', 'data-group': `langs-${kind}` },
    chip('__all', 'Todos os idiomas', total), shown.map((l) => chip(l, langLabel(l), counts.get(l))), more);
}

// Categorias com contagem sobre a lista já filtrada por idioma (as vazias somem).
export function catButtons(kind, state, list, onPick, extra = []) {
  // Ao vivo, as qualidades do mesmo canal contam uma vez (como aparecem na lista).
  const shown = kind === 'live' ? collapseVariants(list) : list;
  const counts = new Map();
  for (const i of shown) counts.set(i.cat, (counts.get(i.cat) || 0) + 1);
  const all = [
    // Em filmes e séries, "Todos" conta cartões: as versões de um título contam uma vez.
    { id: '__all', name: 'Todos', n: kind === 'live' ? shown.length : collapseVersions(list).length },
    { id: '__fav', name: 'Favoritos', n: byLang(favItems(kind), state.lang).length },
    ...extra,
    ...S.data.cats[kind].map((c) => ({ id: c.id, name: c.name, n: counts.get(c.id) || 0, locked: c.locked })).filter((c) => c.n > 0 || c.locked),
  ];
  return all.map((c) => h('button', {
    class: `cat${state.cat === c.id ? ' on' : ''}`, 'data-cat': c.id,
    // Categoria bloqueada: pede o PIN; liberada, redesenha a tela já com os itens dela.
    onclick: async (e) => {
      if (c.locked) { if (await unlock()) { state.cat = c.id; rerenderView(); } return; }
      onPick(c.id, e.currentTarget);
    },
  }, h('span', { class: 'cat-name' }, c.locked ? icon('lock') : null, c.name), h('span', { class: 'cat-n' }, c.locked ? '' : String(c.n))));
}

export function organizeButton(kind) {
  return h('button', { class: 'btn sm', title: 'Ordenar, ocultar e bloquear categorias', onclick: () => organizeCategories(kind, rerenderView) }, 'Organizar');
}

// ---- Mesmo canal em várias qualidades ----
// Primeira ocorrência de cada grupo (o cartão/linha representa o grupo).
export function collapseVariants(list) {
  const seen = new Set();
  const out = [];
  for (const it of list) {
    if (variantsOf(it)) {
      if (seen.has(it.qkey)) continue;
      seen.add(it.qkey);
    }
    out.push(it);
  }
  return out;
}
export function variantTags(it) {
  const g = variantsOf(it);
  return g ? [...new Set(g.map((v) => v.qlabel || 'Padrão'))].join(' · ') : '';
}

// Canais da categoria escolhida, já filtrados pelo idioma.
export function liveList(state) {
  if (state.cat === '__fav') return byLang(favItems('live'), state.lang);
  const list = byLang(S.data.live, state.lang);
  return collapseVariants(state.cat === '__all' ? list : list.filter((c) => c.cat === state.cat));
}
