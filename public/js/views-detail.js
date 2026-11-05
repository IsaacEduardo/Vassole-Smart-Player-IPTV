// Telas de detalhe: filme e série (temporadas e episódios).
import { S, onChange, isFav, toggleFav, history, xtream, getProgress, displayName } from './store.js';
import { h, icon, img, fmtTime } from './ui.js';
import * as player from './player.js';
import { focusFirst } from './nav.js';
import { itemKey } from './util.js';
import { add, track, needPlaylist, progressBar, versionsRow } from './views-common.js';

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
  add(body, h('h1', null, displayName(it)), versionsRow(it), meta,
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
    title, season: Number(season), episode: num, ext: e.container_extension || e.ext || 'mp4', url: e.url, ua: e.ua, ref: e.ref,
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
  add(body, h('h1', null, displayName(it)), versionsRow(it), meta, h('div', { class: 'row' }, playBtn, favBtn), plot, seasonsEl, epsEl);
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
