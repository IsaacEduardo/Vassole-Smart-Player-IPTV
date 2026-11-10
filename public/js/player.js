// Player: tela, barra de controles, canais e progresso. A reprodução fica no motor da plataforma
// (platform.js → engine-web.js no navegador: hls.js, mpegts.js e <video>).
import { S, streamUrl, epgWithFallback, nowNext, saveHistory, getProgress, toggleFav, isFav, setSetting, emit, displayName, itemNet, preferredVariant, variantsOf } from './store.js';
import { h, icon, fmtClock, fmtTime, toast, choose } from './ui.js';
import { createEngine, caps } from './platform.js';
import { pushScope, popScope, focusEl } from './nav.js';
import { initTracks, onItem, clearTracks, applyPrefs, audioList, hasStreamSubs, pickAudio, pickSubs } from './subs.js';
import { qualityAvailable, pickQuality, pickSpeed } from './player-menus.js';

const P = {
  token: 0, mode: 'closed', item: null, ctx: {}, live: false,
  osdTimer: 0, lastSave: 0, home: null, num: '', numTimer: 0,
  rate: 1, tried: new Set(), // velocidade (filmes/episódios); versões do canal já tentadas
};
let root; let stage; let video; let media; let engine; let osd; let el = {};

const scopeFn = () => (P.mode === 'full' ? root : null);
const ASPECTS = [['contain', 'Ajustar'], ['cover', 'Preencher'], ['fill', 'Esticar']];

export function initPlayer() {
  root = document.getElementById('player');
  video = h('video', { playsinline: true, preload: 'auto' });
  video.setAttribute('playsinline', '');
  engine = createEngine(video, {
    onError: (msg) => fail(msg),
    onBlocked: () => showError('O navegador bloqueou a reprodução automática.', true),
    onTracks: () => { applyPrefs(); updateTrackButtons(); },
    onReload: () => { if (P.item) play(P.item, { ...P.ctx, resume: true, keepRetry: true, exact: true, fallback: true }); },
  }, { prefer: S.settings.androidPlayer });
  media = engine.media;
  // Vídeo nativo (Android): desenhado atrás da página; o <video> da página fica oculto.
  document.documentElement.classList.toggle('native-video', !!engine.nativeVideo);
  el.spinner = h('div', { class: 'spinner', hidden: true });
  el.err = h('div', { class: 'perr', hidden: true });
  stage = h('div', { class: 'stage', onclick: () => { if (P.mode === 'preview') toFull(); } }, video, el.spinner, el.err);

  el.title = h('div', { class: 'osd-title' });
  el.sub = h('div', { class: 'osd-sub' });
  el.clock = h('div', { class: 'osd-clock' });
  el.cur = h('span', { class: 't' });
  el.dur = h('span', { class: 't' });
  el.fill = h('div', { class: 'bar-fill' });
  // Barra de progresso: clique do mouse ou setas ←/→ com ela em foco (controle remoto).
  el.bar = h('div', { class: 'bar', role: 'slider', tabindex: '0', 'data-f': '', 'aria-label': 'Posição', 'aria-valuemin': '0', onclick: (e) => {
    if (e.detail === 0) return; // "clique" vindo do Enter: não há posição
    const r = e.currentTarget.getBoundingClientRect();
    if (Number.isFinite(media.duration)) media.currentTime = ((e.clientX - r.left) / r.width) * media.duration;
  } }, el.fill);
  el.prog = h('div', { class: 'osd-prog' }, el.cur, el.bar, el.dur);
  const btn = (name, label, fn, cls = '') => h('button', { class: `obtn ${cls}`, 'aria-label': label, title: label, onclick: fn }, icon(name));
  el.bPrev = btn('up', 'Canal anterior', () => zap(-1), 'live-only');
  el.bBack = btn('back10', 'Voltar 10 s', () => seek(-10), 'vod-only');
  el.bPlay = btn('pause', 'Reproduzir/pausar', togglePlay, 'big');
  el.bFwd = btn('fwd10', 'Avançar 10 s', () => seek(10), 'vod-only');
  el.bNext = btn('down', 'Próximo canal', () => zap(1), 'live-only');
  const replay = (it) => play(it, { ...P.ctx, mode: P.mode === 'full' ? 'full' : 'preview', mount: P.home, exact: true });
  el.bQuality = btn('quality', 'Qualidade', () => pickQuality(engine, P.item, replay));
  el.bSpeed = btn('speed', 'Velocidade', async () => {
    const r = await pickSpeed(P.rate, engine.speeds);
    if (r === undefined) return;
    P.rate = r;
    media.playbackRate = r;
    toast(r === 1 ? 'Velocidade normal' : `Velocidade ${String(r).replace('.', ',')}×`);
  }, 'vod-only');
  el.bAudio = btn('audio', 'Áudio', pickAudio);
  el.bSubs = btn('cc', 'Legendas', pickSubs);
  el.bAspect = btn('aspect', 'Proporção', cycleAspect);
  el.bFav = btn('star', 'Favorito', async () => {
    if (!P.item || P.item.kind === 'episode') return;
    const on = await toggleFav(P.item);
    el.bFav.classList.toggle('on', on);
    toast(on ? 'Adicionado aos favoritos' : 'Removido dos favoritos');
  });
  el.bFull = btn('full', 'Tela cheia do navegador', () => {
    if (!caps.browserFullscreen) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
  el.bClose = btn('close', 'Fechar', () => close());
  el.bFull.hidden = !caps.browserFullscreen; // apps de TV já ocupam a tela inteira
  el.num = h('div', { class: 'numbox', hidden: true });

  osd = h('div', { class: 'osd' },
    h('div', { class: 'osd-top' }, h('div', { class: 'osd-head' }, el.title, el.sub), el.clock),
    h('div', { class: 'osd-bottom' }, el.prog,
      h('div', { class: 'osd-ctrl' },
        h('div', { class: 'grp' }, el.bPrev, el.bBack, el.bPlay, el.bFwd, el.bNext),
        h('div', { class: 'grp' }, el.bQuality, el.bSpeed, el.bAudio, el.bSubs, el.bAspect, el.bFav, el.bFull, el.bClose))));
  root.append(osd, el.num);
  root.addEventListener('mousemove', () => { if (P.mode === 'full') showOsd(false); });

  media.addEventListener('playing', () => {
    spin(false); el.err.hidden = true; updatePlayIcon();
    const rate = P.live ? 1 : P.rate;
    if (media.playbackRate !== rate) media.playbackRate = rate;
  });
  media.addEventListener('pause', () => { updatePlayIcon(); persist(true); if (P.mode === 'full') showOsd(false); });
  media.addEventListener('waiting', () => spin(true));
  media.addEventListener('canplay', () => spin(false));
  media.addEventListener('timeupdate', onTime);
  media.addEventListener('ended', onEnded);
  setInterval(() => { if (P.mode === 'full') el.clock.textContent = fmtClock(Date.now()); }, 15000);
  initTracks(video, { engine, item: () => P.item, onUpdate: updateTrackButtons });
  applyAspect();
}

export const isFull = () => P.mode === 'full';
export const isActive = () => P.mode !== 'closed';
export const current = () => P.item;

function spin(on) { el.spinner.hidden = !on; }
function showError(msg, clickToPlay = false) {
  spin(false);
  el.err.replaceChildren(h('div', null, msg),
    clickToPlay ? h('button', { class: 'btn primary', onclick: (e) => { e.stopPropagation(); el.err.hidden = true; engine.play(); } }, 'Reproduzir')
      : h('button', { class: 'btn', onclick: (e) => { e.stopPropagation(); retryNow(); } }, 'Tentar de novo'));
  el.err.hidden = false;
  if (P.mode === 'full') requestAnimationFrame(() => focusEl(el.err.querySelector('button')));
}
function retryNow() {
  if (!P.item) return;
  el.err.hidden = true;
  play(P.item, { ...P.ctx, resume: true, exact: true });
}

// Falha definitiva: num canal com várias qualidades, tenta a próxima ainda não tentada.
function fail(msg) {
  const g = P.live ? variantsOf(P.item) : null;
  const next = g && g.find((v) => !P.tried.has(v.key));
  if (!next) { showError(msg); return; }
  toast(`${P.item.qlabel || 'Esta versão'} não respondeu. Tentando ${next.qlabel || 'outra versão'}…`);
  play(next, { ...P.ctx, mode: P.mode === 'full' ? 'full' : 'preview', mount: P.home, exact: true, fallback: true });
}

function tryPlay() { engine.play(); }

async function load(url, live, startAt, token, keepRetry) {
  spin(true);
  el.err.hidden = true;
  if (token !== P.token) return;
  // net: User-Agent/Referer do canal, quando a lista os define.
  await engine.load(url, { live, startAt, net: itemNet(P.item), keepRetry });
}

export async function play(item, ctx = {}) {
  const token = ++P.token;
  const live = item.kind === 'live';
  const { exact, fallback, ...rest } = ctx;
  // Canal com várias qualidades: começa pela escolhida (ou a do ajuste), salvo pedido exato.
  if (live && !exact) item = preferredVariant(item);
  if (!fallback) P.tried = new Set();
  P.tried.add(item.key);
  ctx = rest;
  let startAt = 0;
  if (!live && ctx.resume !== false) {
    const pr = await getProgress(item);
    if (pr && pr.pos > 30 && !pr.watched && (!pr.dur || pr.dur - pr.pos > 30)) {
      if (ctx.resume === true) startAt = pr.pos;
      else {
        const v = await choose('Continuar de onde parou?', [
          { label: `Retomar de ${fmtTime(pr.pos)}`, value: 'r', active: true },
          { label: 'Começar do início', value: 's' },
        ]);
        if (v === undefined || token !== P.token) return;
        if (v === 'r') startAt = pr.pos;
      }
    }
  }
  if (token !== P.token) return;
  if (P.item && !P.live) persist(true);
  P.item = item;
  P.ctx = ctx;
  P.live = live;
  if (ctx.mount) P.home = ctx.mount;
  root.classList.toggle('is-live', live);
  if (ctx.mode === 'preview' && P.mode !== 'full') mountPreview(ctx.mount); else showFull();
  updateInfo();
  onItem(item);
  emit('player-item');
  let url;
  try { url = streamUrl(item); } catch (e) { showError(e.message); return; }
  await load(url, live, startAt, token, !!ctx.keepRetry);
  if (live) saveHistory(item);
}

function mountPreview(mount) {
  P.mode = 'preview';
  mount.replaceChildren(stage);
  if (engine.setViewport) engine.setViewport(stage);
  root.hidden = true;
  document.body.classList.remove('playing');
  popScope(scopeFn);
}

function showFull() {
  if (P.mode !== 'full') {
    P.mode = 'full';
    root.prepend(stage);
    if (engine.setViewport) engine.setViewport(stage);
    root.hidden = false;
    document.body.classList.add('playing');
    pushScope(scopeFn);
  }
  el.clock.textContent = fmtClock(Date.now());
  showOsd(true);
}

export function toFull() {
  if (P.mode === 'closed') return;
  showFull();
}

export function close() {
  if (P.mode === 'full' && P.home && P.home.isConnected && P.live) {
    hideOsd();
    mountPreview(P.home);
    emit('player-item');
    return;
  }
  stop();
}

export function stop() {
  P.token++;
  persist(true);
  engine.destroy();
  if (engine.setViewport) engine.setViewport(null);
  clearTracks();
  spin(false);
  el.err.hidden = true;
  if (P.mode === 'full') popScope(scopeFn);
  P.mode = 'closed';
  root.classList.remove('nocursor', 'osd-on');
  P.item = null;
  P.home = null;
  root.hidden = true;
  stage.remove();
  document.body.classList.remove('playing');
  emit('player-item');
}

function osdVisible() { return osd.classList.contains('show'); }
function showOsd(focus) {
  osd.classList.add('show');
  root.classList.add('osd-on');
  root.classList.remove('nocursor');
  clearTimeout(P.osdTimer);
  P.osdTimer = setTimeout(() => { if (!media.paused && el.err.hidden) hideOsd(); }, 5000);
  if (focus && !osd.contains(document.activeElement)) requestAnimationFrame(() => focusEl(el.bPlay));
}
// A barra some depois de 5 s sem uso; o cursor do mouse some junto.
function hideOsd() {
  osd.classList.remove('show');
  root.classList.remove('osd-on');
  if (P.mode === 'full') root.classList.add('nocursor');
  if (osd.contains(document.activeElement)) root.focus?.();
}

function togglePlay() {
  if (media.paused) tryPlay(); else media.pause();
}
function updatePlayIcon() {
  el.bPlay.replaceChildren(icon(media.paused ? 'play' : 'pause'));
}
function seek(d) {
  if (P.live || !Number.isFinite(media.duration)) return;
  media.currentTime = Math.max(0, Math.min(media.duration - 1, media.currentTime + d));
  onTime();
}

function zap(d) {
  const list = P.ctx.list;
  if (!P.live || !list?.length) return;
  const i = ((P.ctx.index ?? list.indexOf(P.item)) + d + list.length) % list.length;
  play(list[i], { ...P.ctx, index: i, mode: P.mode === 'full' ? 'full' : 'preview' });
}

function onTime() {
  if (P.live) return;
  const d = media.duration;
  if (Number.isFinite(d) && d > 0) {
    el.fill.style.width = `${(media.currentTime / d) * 100}%`;
    el.cur.textContent = fmtTime(media.currentTime);
    el.dur.textContent = fmtTime(d);
    el.bar.setAttribute('aria-valuemax', String(Math.round(d)));
    el.bar.setAttribute('aria-valuenow', String(Math.round(media.currentTime)));
    el.bar.setAttribute('aria-valuetext', `${fmtTime(media.currentTime)} de ${fmtTime(d)}`);
  }
  if (Date.now() - P.lastSave > 5000) persist();
}

function persist(force) {
  if (!P.item || P.live) return;
  const pos = media.currentTime;
  const dur = media.duration;
  if (!Number.isFinite(pos) || pos < 1 || !Number.isFinite(dur)) return;
  if (!force && Date.now() - P.lastSave < 5000) return;
  P.lastSave = Date.now();
  saveHistory(P.item, { pos, dur });
}

function onEnded() {
  if (P.live) return;
  if (P.item) saveHistory(P.item, { pos: media.duration, dur: media.duration });
  const list = P.ctx.list;
  if (P.item?.kind === 'episode' && list) {
    const i = list.findIndex((e) => e.id === P.item.id);
    if (i > -1 && list[i + 1]) {
      toast(`Próximo: ${list[i + 1].name}`);
      play(list[i + 1], { ...P.ctx, index: i + 1, resume: false, mode: 'full' });
      return;
    }
  }
  close();
}

async function updateInfo() {
  const it = P.item;
  el.title.textContent = it.kind === 'live' && it.num ? `${it.num} · ${displayName(it)}` : displayName(it);
  el.sub.textContent = '';
  el.bFav.hidden = it.kind === 'episode';
  el.bFav.classList.toggle('on', it.kind !== 'episode' && isFav(it));
  el.fill.style.width = '0';
  el.cur.textContent = el.dur.textContent = '';
  updateTrackButtons();
  if (it.kind === 'live') {
    const progs = await epgWithFallback(it);
    if (P.item !== it) return;
    const { now, next } = nowNext(progs);
    el.sub.textContent = [now && `Agora: ${now.t} (${fmtClock(now.s)}–${fmtClock(now.e)})`, next && `Depois: ${fmtClock(next.s)} ${next.t}`].filter(Boolean).join('   ·   ');
  } else if (it.kind === 'episode' && it.series) {
    el.sub.textContent = it.series.name;
  }
}

// Áudio: só com mais de uma faixa. Legendas: em filmes e episódios sempre (para carregar uma externa);
// ao vivo, só quando o stream traz legendas.
function updateTrackButtons() {
  el.bAudio.disabled = audioList().length < 2;
  el.bSubs.disabled = !P.item || (P.item.kind === 'live' && !hasStreamSubs());
  el.bQuality.disabled = !qualityAvailable(engine, P.item);
}
function applyAspect() {
  video.style.objectFit = S.settings.aspect || 'contain';
  if (engine.setAspect) engine.setAspect(S.settings.aspect || 'contain');
}
function cycleAspect() {
  const i = ASPECTS.findIndex(([k]) => k === (S.settings.aspect || 'contain'));
  const [k, label] = ASPECTS[(i + 1) % ASPECTS.length];
  setSetting('aspect', k);
  applyAspect();
  toast(`Proporção: ${label}`);
}

function numInput(d) {
  P.num = (P.num + d).slice(-4);
  el.num.textContent = P.num;
  el.num.hidden = false;
  clearTimeout(P.numTimer);
  P.numTimer = setTimeout(() => {
    const n = Number(P.num);
    P.num = '';
    el.num.hidden = true;
    const list = P.ctx.list?.some((c) => c.num === n) ? P.ctx.list : S.data?.live || [];
    const i = list.findIndex((c) => c.num === n);
    if (i > -1) play(list[i], { ...P.ctx, list, index: i, mode: 'full' });
    else toast(`Canal ${n} não encontrado`);
  }, 1500);
}

// Teclas com o player em tela cheia. Retorna true quando a tecla foi tratada.
export function onKey(k) {
  if (P.mode !== 'full') return false;
  const osdOn = osdVisible();
  if (k === 'back') { if (osdOn && !media.paused) hideOsd(); else close(); return true; }
  if (k === 'playpause') { togglePlay(); showOsd(false); return true; }
  if (k === 'chup' || k === 'chdown') { zap(k === 'chup' ? -1 : 1); return true; }
  // Teclas de mídia do controlo (LG, Samsung, Android TV): Parar fecha; ⏩/⏪ avançam ou voltam 30 s.
  if (k === 'stop') { close(); return true; }
  if ((k === 'forward' || k === 'rewind') && !P.live) { seek(k === 'rewind' ? -30 : 30); showOsd(false); return true; }
  if (/^\d$/.test(k) && P.live) { numInput(k); return true; }
  if (!osdOn) {
    if ((k === 'up' || k === 'down') && P.live && P.ctx.list) { zap(k === 'up' ? -1 : 1); return true; }
    if ((k === 'left' || k === 'right') && !P.live) { seek(k === 'left' ? -10 : 10); showOsd(false); return true; }
    showOsd(true);
    return true;
  }
  // Com a barra de progresso em foco, ←/→ voltam ou avançam 10 s.
  if (document.activeElement === el.bar && (k === 'left' || k === 'right')) { seek(k === 'left' ? -10 : 10); showOsd(false); return true; }
  showOsd(false);
  return false;
}
