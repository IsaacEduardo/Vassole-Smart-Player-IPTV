// Motor de reprodução das TVs Samsung: AVPlay (webapis.avplay), com o contrato de platform.js.
// O AVPlay desenha o vídeo no plano de vídeo da TV, atrás da página, no retângulo informado em
// setDisplayRect (coordenadas de 1920×1080). Decodifica HLS, MPEG-TS, MP4/MKV, HEVC e AC-3 por hardware.
// Limitações do AVPlay: não envia Referer por canal; velocidade só em valores inteiros (1×, 2×);
// qualidade do HLS sempre automática (adaptativa).
import { createMedia, createViewport } from './engine-native.js';
import { langName, langOf } from './lang.js';

const call = (fn, ...a) => { if (typeof fn === 'function') fn(...a); };
const AV_STATES_READY = ['READY', 'PLAYING', 'PAUSED'];
// Erros sem nova tentativa: endereço ou formato que não vão mudar repetindo o pedido.
const FATAL = /INVALID_URI|NOT_SUPPORTED|UNSUPPORTED|INVALID_OPERATION|PERMISSION/;

function errorMessage(type) {
  const code = String(type || 'PLAYER_ERROR').replace('PLAYER_ERROR_', '');
  if (/NOT_SUPPORTED|UNSUPPORTED/.test(type)) return `Esta TV não reproduz o formato deste stream (${code}).`;
  if (/CONNECTION|NETWORK|TIMEOUT/.test(type)) return `O stream não respondeu ou parou de enviar vídeo (${code}).`;
  if (/INVALID_URI/.test(type)) return `Endereço do stream inválido (${code}).`;
  return `Falha na reprodução (${code}).`;
}

function parseInfo(s) {
  if (!s) return {};
  try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return {}; }
}

export function createTizenEngine(video, cb = {}, av) {
  let token = 0;
  let retry = 0;
  let live = false;
  let loaded = false;
  let buffering = false;
  let userPaused = false;
  let aspect = 'contain';
  let rect = null;
  let cueFn = null;
  let cueTimer = 0;
  let tick = 0;
  let tracks = { audio: [], text: [] };
  let textOff = false;
  let lastRect = '';

  // O AVPlay exige um <object type="application/avplayer"> na página.
  const obj = document.createElement('object');
  obj.type = 'application/avplayer';
  obj.id = 'av-player';
  obj.setAttribute('style', 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:-1;pointer-events:none;');
  document.body.appendChild(obj);

  const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
  const state = () => safe(() => av.getState(), 'NONE');

  const M = createMedia({
    seek: (t) => safe(() => av.seekTo(Math.max(0, Math.round(t * 1000)), () => {}, () => {})),
    // O AVPlay aceita só velocidades inteiras.
    setRate: (r) => safe(() => av.setSpeed(Math.max(1, Math.round(r)))),
    play: () => { userPaused = false; safe(() => av.play()); },
    pause: () => { userPaused = true; safe(() => av.pause()); },
  });

  function poll() {
    if (!loaded) return;
    const s = state();
    const d = safe(() => av.getDuration(), 0);
    M.update({
      t: safe(() => av.getCurrentTime(), 0) / 1000,
      d: live || !d ? -1 : d / 1000,
      paused: userPaused || s === 'PAUSED',
      playing: s === 'PLAYING' && !buffering,
      buffering,
      ready: AV_STATES_READY.includes(s),
      rate: M.state.rate,
    });
  }

  function readTracks() {
    const all = safe(() => av.getTotalTrackInfo(), []) || [];
    const cur = safe(() => av.getCurrentStreamInfo(), []) || [];
    const active = new Set(cur.map((c) => `${c.type}:${c.index}`));
    const pick = (type) => all.filter((t) => t.type === type).map((t) => {
      const x = parseInfo(t.extra_info);
      const lang = x.language || x.track_lang || '';
      return { index: t.index, lang, name: langName(langOf(lang)), active: active.has(`${type}:${t.index}`) };
    });
    tracks = { audio: pick('AUDIO'), text: pick('TEXT') };
    if (textOff) tracks.text.forEach((t) => { t.active = false; });
    call(cb.onTracks);
  }

  function applyRect() {
    if (!loaded || !rect) return;
    const k = 1920 / (window.innerWidth || 1920); // o AVPlay usa coordenadas de 1920×1080
    const r = [rect.x, rect.y, rect.w, rect.h].map((v) => Math.round(v * k));
    const mode = rect.preview || aspect === 'contain' ? 'PLAYER_DISPLAY_MODE_LETTER_BOX'
      : aspect === 'fill' ? 'PLAYER_DISPLAY_MODE_FULL_SCREEN' : 'PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO';
    const key = r.join(',') + mode;
    if (key === lastRect) return;
    lastRect = key;
    safe(() => av.setDisplayRect(r[0], r[1], r[2], r[3]));
    safe(() => av.setDisplayMethod(mode));
  }
  const view = createViewport((r) => { rect = r && r.w > 0 && r.h > 0 ? r : null; applyRect(); });

  function closeAv() {
    clearInterval(tick);
    tick = 0;
    const s = state();
    if (s !== 'NONE') { safe(() => av.stop()); safe(() => av.close()); }
  }

  function fail(type, tk) {
    if (tk !== token) return;
    if (!FATAL.test(type) && retry < (live ? 2 : 1)) {
      retry++;
      setTimeout(() => { if (tk === token) call(cb.onReload); }, 1500);
      return;
    }
    call(cb.onError, errorMessage(type));
  }

  // Ao sair do app (botão Home, outra fonte) a TV pede para liberar o player; ao voltar, restaura.
  document.addEventListener('visibilitychange', () => {
    if (!loaded) return;
    if (document.hidden) safe(() => av.suspend());
    else safe(() => av.restore());
  });

  return {
    media: M.media,
    nativeVideo: true,
    speeds: [1, 2],
    get kind() { return loaded ? 'native' : ''; },

    async load(url, { live: isLive = false, startAt = 0, net = {}, keepRetry = false } = {}) {
      const tk = ++token;
      live = isLive;
      if (!keepRetry) retry = 0;
      closeAv();
      lastRect = ''; // o retângulo vale para cada open()
      loaded = true;
      buffering = true;
      userPaused = false;
      textOff = false;
      M.reset();
      tracks = { audio: [], text: [] };
      try {
        av.open(url);
        if (net.ua) safe(() => av.setStreamingProperty('USER_AGENT', net.ua));
        av.setListener({
          onbufferingstart: () => { if (tk === token) { buffering = true; poll(); } },
          onbufferingcomplete: () => { if (tk === token) { buffering = false; poll(); } },
          onstreamcompleted: () => { if (tk === token && !live) M.emit('ended'); },
          onerror: (type) => fail(type, tk),
          onevent: () => {},
          onsubtitlechange: (duration, text) => {
            if (tk !== token || !cueFn || textOff) return;
            cueFn(text ? [String(text)] : []);
            clearTimeout(cueTimer);
            cueTimer = setTimeout(() => cueFn && cueFn([]), Math.max(500, Number(duration) || 3000));
          },
        });
        applyRect();
        av.prepareAsync(() => {
          if (tk !== token) return;
          if (startAt) safe(() => av.seekTo(Math.round(startAt * 1000), () => {}, () => {}));
          safe(() => av.play());
          buffering = false;
          readTracks();
          poll();
        }, (err) => fail((err && err.name) || String(err), tk));
        tick = setInterval(poll, 250);
      } catch (e) {
        fail((e && e.name) || 'PLAYER_ERROR_INVALID_URI', tk);
      }
    },
    play() { M.media.play().catch(() => {}); },
    pause() { M.media.pause(); },
    seek(t) { M.media.currentTime = t; },
    destroy() {
      token++;
      loaded = false;
      closeAv();
      M.reset();
      if (cueFn) cueFn([]);
    },

    setViewport(el) { view.set(el); },
    setAspect(mode) { aspect = mode || 'contain'; view.schedule(); },
    setCueListener(fn) { cueFn = fn; },

    audioTracks() { return tracks.audio.map((t, i) => ({ label: t.name || t.lang || `Faixa ${i + 1}`, lang: t.lang, name: t.name, active: t.active })); },
    setAudioTrack(i) {
      const t = tracks.audio[i];
      if (t) { safe(() => av.setSelectTrack('AUDIO', t.index)); readTracks(); }
    },
    subtitleTracks() { return tracks.text.map((t, i) => ({ label: t.name || t.lang || `Legenda ${i + 1}`, lang: t.lang, name: t.name, active: t.active })); },
    setSubtitleTrack(i) {
      const t = tracks.text[i];
      textOff = i < 0 || !t;
      safe(() => av.setSilentSubtitle(textOff));
      if (!textOff) safe(() => av.setSelectTrack('TEXT', t.index));
      if (textOff && cueFn) cueFn([]);
      readTracks();
    },
    markExternal() {},

    // HLS no AVPlay é sempre adaptativo: sem escolha manual de nível.
    levels() { return []; },
    level() { return { auto: true, current: -1 }; },
    setLevel() {},
  };
}
