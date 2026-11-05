// Tela TV ao vivo: categorias, lista de canais, prévia e guia do canal.
import { S, onChange, isFav, toggleFav, epgFor, epgWithFallback, nowNext, displayName, sameChannel, variantsOf } from './store.js';
import { h, icon, img, fmtClock, chunked, debounce } from './ui.js';
import * as player from './player.js';
import { focusEl } from './nav.js';
import { norm } from './util.js';
import { add, track, liveState, needPlaylist, catButtons, liveList, langBar, byLang, checkLang, organizeButton, variantTags } from './views-common.js';

export async function viewLive(root) {
  if (needPlaylist(root)) return;
  root.classList.add('fill');
  checkLang('live', liveState);
  const preview = h('div', { class: 'preview' }, h('div', { class: 'preview-ph' }, icon('live'), h('span', null, 'Escolha um canal')));
  const info = h('div', { class: 'ch-info' });
  const chList = h('div', { class: 'ch-list', 'data-group': 'chs' });
  const cats = h('div', { class: 'cat-list', 'data-group': 'cats' });
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Filtrar canais', value: liveState.q, 'aria-label': 'Filtrar canais' });
  let current = [];
  let lister = null;

  const langs = h('div');
  const renderLangs = () => langs.replaceChildren(langBar('live', liveState, (v) => {
    liveState.lang = v;
    liveState.cat = '__all';
    renderLangs(); renderCats(); renderChannels();
  }) || '');
  const renderCats = () => cats.replaceChildren(...catButtons('live', liveState, byLang(S.data.live, liveState.lang), (id, btn) => {
    liveState.cat = id;
    cats.querySelectorAll('.cat').forEach((b) => b.classList.toggle('on', b === btn));
    renderChannels();
  }));

  function row(ch, i) {
    const now = h('div', { class: 'ch-now' });
    const bar = h('div', { class: 'ch-bar' }, h('div'));
    const playing = sameChannel(player.current(), ch);
    const tags = variantTags(ch);
    const el = h('button', {
      class: `ch-row${playing ? ' playing' : ''}`, 'data-key': ch.key,
      onclick: () => {
        if (player.isActive() && sameChannel(player.current(), ch)) player.toFull();
        else player.play(ch, { mode: 'preview', mount: preview, list: current, index: i });
      },
      ondblclick: () => player.toFull(),
      onfocus: () => showInfoSoon(ch),
    },
    h('span', { class: 'ch-num' }, ch.num ? String(ch.num) : ''),
    h('span', { class: 'ch-logo' }, img(ch.logo, '')),
    h('span', { class: 'ch-main' }, h('span', { class: 'ch-name' }, displayName(ch), tags ? h('span', { class: 'ch-q' }, tags) : null), now, bar),
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
    current = liveList(liveState).filter((c) => words.every((w) => (c.n || norm(c.name)).includes(w)));
    if (!current.length) { chList.append(h('p', { class: 'muted pad' }, liveState.cat === '__fav' ? 'Nenhum canal favorito. Use o botão de estrela durante a reprodução ou no painel ao lado.' : 'Nenhum canal.')); return; }
    lister = chunked(chList, current, row, { root: chList.parentElement });
  }

  let infoItem = null;
  const showInfoSoon = debounce((ch) => showInfo(ch), 200);
  // Qualidades do mesmo canal: tocar uma delas e lembrar a escolha nesta sessão.
  function variantsRow(ch) {
    const g = variantsOf(ch);
    if (!g) return null;
    return h('div', { class: 'versions', 'data-group': 'variants' }, h('span', { class: 'muted small' }, 'Qualidades:'),
      g.map((v) => h('button', {
        class: `chip${player.current()?.key === v.key ? ' on' : ''}`, title: displayName(v),
        onclick: () => {
          S.variantChoice.set(ch.qkey, v.key);
          player.play(v, { mode: 'preview', mount: preview, list: current, index: current.indexOf(ch), exact: true });
          showInfo(ch);
        },
      }, v.qlabel || 'Padrão')));
  }
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
        h('div', null, h('h2', null, displayName(ch)), h('div', { class: 'muted' }, ch.num ? `Canal ${ch.num}` : ''))),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm primary', onclick: () => {
          if (sameChannel(player.current(), ch)) player.toFull();
          else player.play(ch, { mode: 'full', mount: preview, list: current, index: current.indexOf(ch) });
        } }, icon('full'), 'Tela cheia'), favBtn),
      variantsRow(ch),
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

  add(root, h('div', { class: 'with-langs' }, langs, h('div', { class: 'live' },
    h('aside', { class: 'col' }, h('div', { class: 'col-title row' }, h('h2', null, 'Categorias'), organizeButton('live')), cats),
    h('section', { class: 'col' }, h('div', { class: 'col-title row' }, h('h2', null, 'Canais'), q), chList),
    h('aside', { class: 'col side' }, preview, info))));
  renderLangs();
  renderCats();
  renderChannels();

  const cur = player.current();
  if (cur?.kind === 'live' && player.isActive()) {
    player.play(cur, { mode: 'preview', mount: preview, list: current, index: current.findIndex((c) => sameChannel(c, cur)), exact: true });
  }
  const off = onChange((what) => {
    if (what !== 'player-item') return;
    const cur2 = player.current();
    chList.querySelectorAll('.ch-row.playing').forEach((r) => r.classList.remove('playing'));
    const k = cur2 && current.find((c) => sameChannel(c, cur2))?.key;
    if (k) {
      const r = chList.querySelector(`[data-key="${CSS.escape(k)}"]`);
      if (r) { r.classList.add('playing'); if (!player.isFull()) focusEl(r); }
    }
  });
  track(off);
  track(() => lister?.destroy());
  const curRow = cur && current.find((c) => sameChannel(c, cur));
  const target = (curRow && chList.querySelector(`[data-key="${CSS.escape(curRow.key)}"]`)) || chList.querySelector('.ch-row');
  if (target) { target.setAttribute('data-autofocus', ''); showInfo(current.find((c) => c.key === target.dataset.key)); }
}
