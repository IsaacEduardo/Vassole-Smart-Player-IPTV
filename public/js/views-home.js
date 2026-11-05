// Tela Início: continuar assistindo, recentes e favoritos.
import { S, favItems, history } from './store.js';
import { h, icon, img, fmtTime, fmtDate, ago } from './ui.js';
import * as player from './player.js';
import { add, go, needPlaylist, progressBar, shelf, channelCard, posterCard } from './views-common.js';

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
