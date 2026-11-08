// Legendas e faixas de áudio do player: faixas do stream, legenda externa (.srt/.vtt) como <track>,
// sincronia, idioma preferido e aparência. A legenda externa e o ajuste ficam salvos por filme ou episódio.
import { S } from './store.js';
import * as db from './db.js';
import { h, toast, choose, modal } from './ui.js';
import { netFetch } from './net.js';
import { itemKey } from './util.js';
import { langOf } from './lang.js';
import { decodeText, parseSubtitle, buildVtt, fmtOffset } from './subs-core.js';

const T = {
  video: null, engine: null, item: () => null, onUpdate: () => {},
  ext: null, // { cues, name, lang, offset, el, url, show }
  layer: null, streamTexts: [], shown: '', // player nativo: legendas desenhadas pelo app
  manualSubs: false, manualAudio: false, token: 0,
};

const SIZES = { s: '3.4vh', m: '4.6vh', l: '5.8vh', xl: '7.2vh' };
const COLORS = { white: '#ffffff', yellow: '#ffe14d' };
const BGS = { none: 'transparent', semi: 'rgba(0, 0, 0, .6)', solid: '#000000' };
const LINE = { bottom: '', raised: '78%', top: '6%' };

// engine: motor de reprodução (platform.js). As faixas do stream vêm dele; a legenda externa é
// desenhada pelo app no próprio <video>.
export function initTracks(video, { engine, item, onUpdate }) {
  Object.assign(T, { video, engine, item, onUpdate });
  for (const list of [video.textTracks, video.audioTracks]) {
    if (!list?.addEventListener) continue;
    list.addEventListener('addtrack', () => { applyPrefs(); T.onUpdate(); });
    list.addEventListener('removetrack', () => T.onUpdate());
  }
  video.addEventListener('loadedmetadata', () => { applyPrefs(); T.onUpdate(); });
  // Player nativo (Android): o vídeo não está no <video>; as legendas vão numa camada sobre o palco.
  if (engine.nativeVideo) {
    T.layer = h('div', { class: 'cue-layer', 'aria-live': 'off' });
    video.parentElement.append(T.layer);
    engine.setCueListener((texts) => { T.streamTexts = texts; renderCues(); });
    engine.media.addEventListener('timeupdate', renderCues);
  }
  applyCueStyle();
}

// Desenha a fala atual: a da legenda externa (pelo tempo do player e o ajuste) ou a do stream.
function renderCues() {
  if (!T.layer) return;
  let texts = T.streamTexts;
  if (extOn()) {
    const t = T.engine.media.currentTime;
    const off = T.ext.offset || 0;
    texts = T.ext.cues.filter((c) => c.s + off <= t && t < c.e + off).map((c) => c.text);
  }
  const plain = texts.map((x) => String(x).replace(/<[^>]+>/g, ''));
  const key = plain.join('\n');
  if (key === T.shown) return;
  T.shown = key;
  T.layer.replaceChildren(...plain.flatMap((x, i) => (i ? [h('br'), h('span', { class: 'cue' }, x)] : [h('span', { class: 'cue' }, x)])));
}

const vodItem = (it) => !!it && it.kind !== 'live';
const keyFor = (it) => itemKey(S.pl.id, it.kind, it.id);
const extTrack = () => T.ext?.el?.track || null;
const extOn = () => !!T.ext && (T.ext.el ? T.ext.el.track.mode === 'showing' : !!T.ext.show);

// ---- Ciclo de vida ----
export async function onItem(item) {
  const tok = ++T.token;
  removeExternal();
  T.manualSubs = false;
  T.manualAudio = false;
  if (!vodItem(item) || !S.pl) return;
  let rec = null;
  try { rec = await db.get('subtitles', keyFor(item)); } catch { /* sem legenda salva */ }
  if (tok !== T.token || !rec?.text) return;
  try {
    attachExternal(parseSubtitle(rec.text), { name: rec.name, lang: rec.lang, offset: rec.offset, show: rec.enabled !== false });
  } catch { /* registro inválido: ignora */ }
}

export function clearTracks() { T.token++; removeExternal(); }

// Desativa antes de remover: o Chrome mantém na tela a fala de um <track> removido enquanto ela estava visível.
function dropTrackEl(el, url) {
  if (el) { el.track.mode = 'disabled'; el.remove(); }
  if (url) URL.revokeObjectURL(url);
}

function removeExternal() {
  if (!T.ext) return;
  dropTrackEl(T.ext.el, T.ext.url);
  T.ext = null;
  T.onUpdate();
  renderCues();
}

function attachExternal(cues, { name, lang, offset = 0, show = true }) {
  removeExternal();
  T.ext = { cues, name: name || 'legenda', lang: lang || langOf(name), offset: offset || 0, el: null, url: '' };
  renderExternal(show);
}

// (Re)cria o <track> com o ajuste e a posição atuais.
function renderExternal(show) {
  const x = T.ext;
  if (!x) return;
  dropTrackEl(x.el, x.url);
  if (T.engine.nativeVideo) { // player nativo: a camada do app desenha a legenda
    x.el = null;
    x.show = show;
    if (show) hideStreamSubs();
    T.onUpdate();
    renderCues();
    return;
  }
  const vtt = buildVtt(x.cues, { offset: x.offset, line: LINE[S.settings.subPos] || '' });
  x.url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
  x.el = h('track', { kind: 'subtitles', label: `Externa: ${x.name}`, src: x.url });
  if (x.lang) x.el.srclang = x.lang;
  T.video.append(x.el);
  T.engine.markExternal(x.el.track);
  x.el.track.mode = show ? 'showing' : 'disabled';
  if (show) hideStreamSubs();
  T.onUpdate();
}

function hideStreamSubs() {
  if (T.engine.subtitleTracks().some((t) => t.active)) T.engine.setSubtitleTrack(-1);
}

async function persistExt() {
  const it = T.item();
  if (!T.ext || !vodItem(it) || !S.pl) return;
  await db.put('subtitles', {
    key: keyFor(it), pid: S.pl.id, name: T.ext.name, lang: T.ext.lang,
    text: buildVtt(T.ext.cues), offset: T.ext.offset, enabled: extOn(), updated: Date.now(),
  }).catch(() => {});
}

// ---- Listas de faixas ----
function streamSubOptions() {
  const on = extOn();
  return T.engine.subtitleTracks().map((t, i) => ({ label: t.label, value: `s${i}`, active: !on && t.active }));
}

export const hasStreamSubs = () => T.engine.subtitleTracks().length > 0;

export function audioList() {
  return T.engine.audioTracks().map((t, i) => ({ label: t.label, value: i, active: t.active }));
}

// ---- Preferências de idioma ----
export function applyPrefs() {
  const E = T.engine;
  if (T.ext && extOn() && !T.manualSubs) hideStreamSubs();
  const aud = S.settings.audioLang;
  if (aud && !T.manualAudio) {
    const list = E.audioTracks();
    const i = list.findIndex((t) => langOf(t.lang, t.name) === aud);
    if (list.length > 1 && i > -1 && !list[i].active) E.setAudioTrack(i);
  }
  const sub = S.settings.subLang;
  if (sub && !T.manualSubs && !extOn()) {
    const list = E.subtitleTracks();
    const i = list.findIndex((t) => langOf(t.lang, t.name) === sub);
    if (i > -1 && !list[i].active) E.setSubtitleTrack(i);
  }
}

// ---- Menus ----
export async function pickAudio() {
  const list = audioList();
  if (list.length < 2) { toast('Apenas uma faixa de áudio'); return; }
  const v = await choose('Faixa de áudio', list);
  if (v === undefined) return;
  T.manualAudio = true;
  T.engine.setAudioTrack(v);
}

export async function pickSubs() {
  const it = T.item();
  const vod = vodItem(it);
  const list = streamSubOptions();
  if (T.ext) list.push({ label: `Externa: ${T.ext.name}`, value: 'ext', active: extOn() });
  const opts = [{ label: 'Desativadas', value: 'off', active: !list.some((o) => o.active) }, ...list];
  if (vod) {
    opts.push({ label: 'Carregar legenda de um arquivo…', value: 'file' }, { label: 'Carregar legenda de um link…', value: 'url' });
    if (T.ext) {
      opts.push({ label: `Sincronia da legenda externa (${fmtOffset(T.ext.offset)})…`, value: 'sync' }, { label: 'Remover legenda externa', value: 'remove' });
    }
  }
  if (opts.length < 2) { toast('Sem legendas neste conteúdo'); return; }
  const v = await choose('Legendas', opts);
  if (v === undefined) return;
  if (v === 'file') { loadFromFile(); return; }
  if (v === 'url') { loadFromUrl(); return; }
  if (v === 'sync') { syncDialog(); return; }
  T.manualSubs = true;
  if (v === 'remove') {
    removeExternal();
    if (vod && S.pl) await db.del('subtitles', keyFor(it)).catch(() => {});
    toast('Legenda externa removida');
    return;
  }
  selectSub(v);
  if (T.ext) persistExt();
}

function selectSub(v) {
  const ext = extTrack();
  if (ext) ext.mode = v === 'ext' ? 'showing' : 'disabled';
  else if (T.ext) T.ext.show = v === 'ext';
  T.engine.setSubtitleTrack(v[0] === 's' ? Number(v.slice(1)) : -1);
  T.onUpdate();
}

// ---- Carregar legenda externa ----
async function useBytes(bytes, name) {
  const tok = T.token;
  const cues = parseSubtitle(decodeText(bytes));
  if (tok !== T.token) return; // o conteúdo mudou enquanto carregava
  T.manualSubs = true;
  attachExternal(cues, { name, show: true });
  await persistExt();
  toast(`Legenda carregada: ${cues.length} falas`);
}

function loadFromFile() {
  const input = h('input', { type: 'file', accept: '.srt,.vtt,text/vtt,application/x-subrip', hidden: true });
  input.addEventListener('change', async () => {
    const f = input.files[0];
    input.remove();
    if (!f) return;
    try { await useBytes(new Uint8Array(await f.arrayBuffer()), f.name); } catch (e) { toast(`Não foi possível usar a legenda: ${e.message}`, 6000); }
  });
  document.body.append(input);
  input.click();
}

function loadFromUrl() {
  const inp = h('input', { class: 'input', type: 'url', inputmode: 'url', placeholder: 'http://…/legenda.srt', 'aria-label': 'Link da legenda', autocomplete: 'off', spellcheck: 'false' });
  const err = h('p', { class: 'err', hidden: true });
  const go = async () => {
    const url = inp.value.trim();
    if (!/^https?:\/\//i.test(url)) { err.textContent = 'Informe um link http:// ou https://.'; err.hidden = false; return; }
    err.hidden = true;
    try {
      const r = await netFetch(url, S.net);
      let name = 'legenda';
      try { name = decodeURIComponent(new URL(url).pathname.split('/').pop()) || name; } catch { /* nome padrão */ }
      await useBytes(new Uint8Array(await r.arrayBuffer()), name);
      m.close();
    } catch (e) { err.textContent = e.message; err.hidden = false; }
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  const m = modal([
    h('h2', null, 'Legenda de um link'),
    h('p', { class: 'muted small' }, 'Arquivo .srt ou .vtt. O download passa pelo servidor local quando o proxy está ativo.'),
    inp, err,
    h('div', { class: 'row end' },
      h('button', { class: 'btn', onclick: () => m.close() }, 'Cancelar'),
      h('button', { class: 'btn primary', onclick: go }, 'Carregar')),
  ], { cls: 'wide' });
}

function syncDialog() {
  if (!T.ext) return;
  const val = h('div', { class: 'sync-val', 'aria-live': 'polite' });
  const show = () => { val.textContent = T.ext ? `Ajuste atual: ${fmtOffset(T.ext.offset)}` : ''; };
  const set = (o) => {
    if (!T.ext) return;
    T.ext.offset = Math.round(o * 10) / 10;
    renderExternal(true);
    show();
    persistExt();
  };
  const m = modal([
    h('h2', null, 'Sincronia da legenda'),
    h('p', { class: 'muted small' }, 'Use “Atrasar” se a legenda aparece antes da fala e “Adiantar” se aparece depois.'),
    val,
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => set(T.ext.offset - 0.5) }, 'Adiantar 0,5 s'),
      h('button', { class: 'btn', onclick: () => set(T.ext.offset + 0.5) }, 'Atrasar 0,5 s'),
      h('button', { class: 'btn', onclick: () => set(0) }, 'Zerar')),
    h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: () => m.close() }, 'Concluir')),
  ]);
  show();
}

// ---- Aparência ----
export function applyCueStyle() {
  const st = S.settings;
  let el = document.getElementById('cue-style');
  if (!el) { el = h('style', { id: 'cue-style' }); document.head.append(el); }
  const bg = BGS[st.subBg] || BGS.semi;
  el.textContent = `video::cue { font-family: "Atkinson Hyperlegible", system-ui, sans-serif; line-height: 1.25;
  font-size: ${SIZES[st.subSize] || SIZES.m}; color: ${COLORS[st.subColor] || COLORS.white}; background-color: ${bg};
  ${bg === 'transparent' ? 'text-shadow: 0 0 3px #000, 0 0 6px #000, 1px 1px 2px #000;' : ''} }
.cue-layer .cue { font-family: "Atkinson Hyperlegible", system-ui, sans-serif; line-height: 1.35;
  font-size: ${SIZES[st.subSize] || SIZES.m}; color: ${COLORS[st.subColor] || COLORS.white}; background-color: ${bg};
  ${bg === 'transparent' ? 'text-shadow: 0 0 3px #000, 0 0 6px #000, 1px 1px 2px #000;' : ''} }`;
  if (T.layer) T.layer.className = `cue-layer ${st.subPos === 'top' ? 'top' : st.subPos === 'raised' ? 'raised' : ''}`;
  if (T.ext) renderExternal(extOn());
}
