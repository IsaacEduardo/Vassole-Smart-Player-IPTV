// Tela Guia: grade de programação de 6 horas.
import { S, epgFor } from './store.js';
import { h, img, fmtClock, ago, modal, chunked } from './ui.js';
import { add, track, liveState, needPlaylist, catButtons, liveList, playLive } from './views-common.js';

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
