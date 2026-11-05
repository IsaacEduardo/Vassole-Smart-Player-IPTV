// Player: HLS (hls.js), MPEG-TS (mpegts.js) e reprodução nativa (MP4/WebM/MKV conforme o navegador).
import { S, streamUrl, epgWithFallback, nowNext, saveHistory, getProgress, toggleFav, isFav, setSetting, emit, displayName, itemNet, preferredVariant, variantsOf } from './store.js';
import { h, icon, fmtClock, fmtTime, toast, choose, loadScript } from './ui.js';
import { toNet } from './net.js';
import { pushScope, popScope, focusEl } from './nav.js';
import { initTracks, onItem, clearTracks, applyPrefs, audioList, hasStreamSubs, pickAudio, pickSubs } from './subs.js';
import { qualityAvailable, pickQuality, pickSpeed } from './player-menus.js';

const P = {
  token: 0, mode: 'closed', item: null, ctx: {}, live: false, hls: null, mts: null,
  retry: 0, osdTimer: 0, lastSave: 0, home: null, num: '', numTimer: 0,
  rate: 1, tried: new Set(), // velocidade (filmes/episódios); versões do canal já tentadas
};
let root; let stage; let video; let osd; let el = {};

const scopeFn = () => (P.mode === 'full' ? root : null);
const ASPECTS = [['contain', 'Ajustar'], ['cover', 'Preencher'], ['fill', 'Esticar']];

export function initPlayer() {
  root = document.getElementById('player');
  video = h('video', { playsinline: true, preload: 'auto' });
  video.setAttribute('playsinline', '');
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
    if (Number.isFinite(video.duration)) video.currentTime = ((e.clientX - r.left) / r.width) * video.duration;
  } }, el.fill);
  el.prog = h('div', { class: 'osd-prog' }, el.cur, el.bar, el.dur);
  const btn = (name, label, fn, cls = '') => h('button', { class: `obtn ${cls}`, 'aria-label': label, title: label, onclick: fn }, icon(name));
  el.bPrev = btn('up', 'Canal anterior', () => zap(-1), 'live-only');
  el.bBack = btn('back10', 'Voltar 10 s', () => seek(-10), 'vod-only');
  el.bPlay = btn('pause', 'Reproduzir/pausar', togglePlay, 'big');
  el.bFwd = btn('fwd10', 'Avançar 10 s', () => seek(10), 'vod-only');
  el.bNext = btn('down', 'Próximo canal', () => zap(1), 'live-only');
  const replay = (it) => play(it, { ...P.ctx, mode: P.mode === 'full' ? 'full' : 'preview', mount: P.home, exact: true });
  el.bQuality = btn('quality', 'Qualidade', () => pickQuality(P.hls, P.item, replay));
  el.bSpeed = btn('speed', 'Velocidade', async () => {
    const r = await pickSpeed(P.rate);
    if (r === undefined) return;
    P.rate = r;
    video.playbackRate = r;
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
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
  el.bClose = btn('close', 'Fechar', () => close());
  el.num = h('div', { class: 'numbox', hidden: true });

  osd = h('div', { class: 'osd' },
    h('div', { class: 'osd-top' }, h('div', { class: 'osd-head' }, el.title, el.sub), el.clock),
    h('div', { class: 'osd-bottom' }, el.prog,
      h('div', { class: 'osd-ctrl' },
        h('div', { class: 'grp' }, el.bPrev, el.bBack, el.bPlay, el.bFwd, el.bNext),
        h('div', { class: 'grp' }, el.bQuality, el.bSpeed, el.bAudio, el.bSubs, el.bAspect, el.bFav, el.bFull, el.bClose))));
  root.append(osd, el.num);
  root.addEventListener('mousemove', () => { if (P.mode === 'full') showOsd(false); });

  video.addEventListener('playing', () => {
    spin(false); el.err.hidden = true; P.retry = 0; updatePlayIcon();
    const rate = P.live ? 1 : P.rate;
    if (video.playbackRate !== rate) video.playbackRate = rate;
  });
  video.addEventListener('pause', () => { updatePlayIcon(); persist(true); if (P.mode === 'full') showOsd(false); });
  video.addEventListener('waiting', () => spin(true));
  video.addEventListener('canplay', () => spin(false));
  video.addEventListener('timeupdate', onTime);
  video.addEventListener('ended', onEnded);
  video.addEventListener('error', () => {
    if (P.hls || P.mts || !P.item) return;
    const c = video.error?.code;
    fail(c === 4 ? 'Formato ou codec não suportado por este navegador.' : c === 3 ? 'Erro ao decodificar o vídeo.' : 'Não foi possível carregar o vídeo.');
  });
  setInterval(() => { if (P.mode === 'full') el.clock.textContent = fmtClock(Date.now()); }, 15000);
  initTracks(video, { hls: () => P.hls, item: () => P.item, onUpdate: updateTrackButtons });
  applyAspect();
}

export const isFull = () => P.mode === 'full';
export const isActive = () => P.mode !== 'closed';
export const current = () => P.item;

function spin(on) { el.spinner.hidden = !on; }
function showError(msg, clickToPlay = false) {
  spin(false);
  el.err.replaceChildren(h('div', null, msg),
    clickToPlay ? h('button', { class: 'btn primary', onclick: (e) => { e.stopPropagation(); el.err.hidden = true; video.play().catch(() => {}); } }, 'Reproduzir')
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

function teardown() {
  if (P.hls) { try { P.hls.destroy(); } catch { /* */ } P.hls = null; }
  if (P.mts) {
    try { P.mts.pause(); P.mts.unload(); P.mts.detachMediaElement(); P.mts.destroy(); } catch { /* */ }
    P.mts = null;
  }
  video.removeAttribute('src');
  try { video.load(); } catch { /* */ }
}

async function pickEngine(url, live, net) {
  let path = url.toLowerCase();
  try { path = new URL(url).pathname.toLowerCase(); } catch { /* */ }
  if (/\.m3u8?$/.test(path)) return 'hls';
  if (/\.ts$/.test(path)) return 'mpegts';
  if (/\.(mp4|m4v|webm|mov|mkv|ogv|mp3|aac|m4a)$/.test(path)) return 'native';
  // Extensão desconhecida: lê os primeiros bytes para decidir.
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(toNet(url, net), { signal: ac.signal, headers: { Range: 'bytes=0-2047' } });
    const ct = r.headers.get('content-type') || '';
    const { value } = await r.body.getReader().read();
    ac.abort();
    if (/mpegurl/i.test(ct)) return 'hls';
    if (value && new TextDecoder().decode(value.slice(0, 32)).includes('#EXTM3U')) return 'hls';
    if (value && value[0] === 0x47) return 'mpegts';
    if (/mp2t/i.test(ct)) return 'mpegts';
    if (/^(video|audio)\//i.test(ct)) return 'native';
  } catch { /* segue o padrão */ } finally { clearTimeout(t); }
  return live ? 'mpegts' : 'native';
}

function tryPlay() {
  const pr = video.play();
  if (pr) pr.catch((e) => { if (e.name === 'NotAllowedError') showError('O navegador bloqueou a reprodução automática.', true); });
}

async function load(url, live, startAt, token) {
  teardown();
  spin(true);
  el.err.hidden = true;
  const net = itemNet(P.item); // User-Agent/Referer do canal, quando a lista os define
  const engine = await pickEngine(url, live, net);
  if (token !== P.token) return;
  const src = toNet(url, net);
  P.engine = engine;
  try {
    if (engine === 'hls') {
      await loadScript('vendor/hls.min.js');
      if (token !== P.token) return;
      const Hls = window.Hls;
      if (Hls && Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, backBufferLength: live ? 10 : 60, maxBufferLength: 30, liveDurationInfinity: true, startPosition: startAt || -1 });
        P.hls = hls;
        hls.on(Hls.Events.ERROR, (_, d) => onHlsError(d, token));
        hls.on(Hls.Events.MANIFEST_PARSED, () => { tryPlay(); updateTrackButtons(); });
        const tracksChanged = () => { applyPrefs(); updateTrackButtons(); };
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, tracksChanged);
        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, tracksChanged);
        hls.loadSource(src);
        hls.attachMedia(video);
        return;
      }
      if (!video.canPlayType('application/vnd.apple.mpegurl')) throw new Error('Este navegador não reproduz HLS.');
    } else if (engine === 'mpegts') {
      await loadScript('vendor/mpegts.js');
      if (token !== P.token) return;
      const m = window.mpegts;
      if (m && m.getFeatureList().mseLivePlayback) {
        const p = m.createPlayer({ type: 'mpegts', isLive: live, url: src }, {
          enableWorker: true, lazyLoad: false, liveBufferLatencyChasing: live, autoCleanupSourceBuffer: true,
        });
        P.mts = p;
        p.on(m.Events.ERROR, (type, detail) => onMtsError(type, detail, token));
        p.attachMediaElement(video);
        p.load();
        tryPlay();
        return;
      }
    }
    video.src = src;
    if (startAt) video.addEventListener('loadedmetadata', () => { video.currentTime = startAt; }, { once: true });
    tryPlay();
  } catch (e) {
    fail(e.message);
  }
}

function onHlsError(d, token) {
  if (token !== P.token || !d.fatal) return;
  const Hls = window.Hls;
  // Manifesto que não carregou: startLoad() não o pede de novo. Erro 4xx falha na hora (e passa
  // para outra versão do canal); outros erros (rede, tempo esgotado) recarregam o stream uma vez.
  if (/manifest/i.test(d.details || '')) {
    const code = d.response?.code || 0;
    if (!(code >= 400 && code < 500) && P.retry < 1) {
      P.retry++;
      setTimeout(() => { if (token === P.token) play(P.item, { ...P.ctx, resume: true, keepRetry: true, exact: true, fallback: true }); }, 1500);
      return;
    }
  } else if (d.type === Hls.ErrorTypes.NETWORK_ERROR && P.retry < 3) {
    P.retry++;
    setTimeout(() => { if (token === P.token && P.hls) P.hls.startLoad(); }, 1200 * P.retry);
    return;
  }
  if (d.type === Hls.ErrorTypes.MEDIA_ERROR && P.retry < 2) { P.retry++; P.hls.recoverMediaError(); return; }
  const codec = /codec|incompatible/i.test(d.details || '');
  const manifest = /manifest/i.test(d.details || '');
  fail(codec ? 'Codec não suportado por este navegador (ex.: HEVC ou AC-3).'
    : manifest ? `O stream não respondeu (${d.response?.code || d.details}). Verifique a conta, o proxy ou o formato ao vivo nos Ajustes.`
      : `Falha na reprodução (${d.details}).`);
}

function onMtsError(type, detail, token) {
  if (token !== P.token) return;
  if (P.retry < 2 && P.live) {
    P.retry++;
    setTimeout(() => { if (token === P.token) play(P.item, { ...P.ctx, resume: true, keepRetry: true, exact: true, fallback: true }); }, 1500);
    return;
  }
  fail(`Falha na reprodução (${type}${detail ? `: ${detail}` : ''}).`);
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
  if (!ctx.keepRetry) P.retry = 0;
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
  await load(url, live, startAt, token);
  if (live) saveHistory(item);
}

function mountPreview(mount) {
  P.mode = 'preview';
  mount.replaceChildren(stage);
  root.hidden = true;
  document.body.classList.remove('playing');
  popScope(scopeFn);
}

function showFull() {
  if (P.mode !== 'full') {
    P.mode = 'full';
    root.prepend(stage);
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
  teardown();
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
  P.osdTimer = setTimeout(() => { if (!video.paused && el.err.hidden) hideOsd(); }, 5000);
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
  if (video.paused) tryPlay(); else video.pause();
}
function updatePlayIcon() {
  el.bPlay.replaceChildren(icon(video.paused ? 'play' : 'pause'));
}
function seek(d) {
  if (P.live || !Number.isFinite(video.duration)) return;
  video.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + d));
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
  const d = video.duration;
  if (Number.isFinite(d) && d > 0) {
    el.fill.style.width = `${(video.currentTime / d) * 100}%`;
    el.cur.textContent = fmtTime(video.currentTime);
    el.dur.textContent = fmtTime(d);
    el.bar.setAttribute('aria-valuemax', String(Math.round(d)));
    el.bar.setAttribute('aria-valuenow', String(Math.round(video.currentTime)));
    el.bar.setAttribute('aria-valuetext', `${fmtTime(video.currentTime)} de ${fmtTime(d)}`);
  }
  if (Date.now() - P.lastSave > 5000) persist();
}

function persist(force) {
  if (!P.item || P.live) return;
  const pos = video.currentTime;
  const dur = video.duration;
  if (!Number.isFinite(pos) || pos < 1 || !Number.isFinite(dur)) return;
  if (!force && Date.now() - P.lastSave < 5000) return;
  P.lastSave = Date.now();
  saveHistory(P.item, { pos, dur });
}

function onEnded() {
  if (P.live) return;
  if (P.item) saveHistory(P.item, { pos: video.duration, dur: video.duration });
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
  el.bQuality.disabled = !qualityAvailable(P.hls, P.item);
}
function applyAspect() { video.style.objectFit = S.settings.aspect || 'contain'; }
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
  if (k === 'back') { if (osdOn && !video.paused) hideOsd(); else close(); return true; }
  if (k === 'playpause') { togglePlay(); showOsd(false); return true; }
  if (k === 'chup' || k === 'chdown') { zap(k === 'chup' ? -1 : 1); return true; }
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
