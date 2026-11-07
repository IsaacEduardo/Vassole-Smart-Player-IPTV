// Camada de plataforma: onde o app está rodando, o que essa plataforma permite, teclas do controle
// remoto e o motor de reprodução. Plataformas: browser (com server.mjs), android (Capacitor),
// tizen (Samsung) e webos (LG).
//
// Contrato do motor de reprodução (createEngine). Os motores nativos das próximas fases
// (ExoPlayer, AVPlay, <video> do webOS) seguem a mesma interface:
//   engine.media            objeto com a interface de HTMLMediaElement usada pelo player:
//                           currentTime, duration, paused, playbackRate, error, play(), pause(),
//                           addEventListener('playing'|'pause'|'waiting'|'canplay'|'timeupdate'|
//                           'ended'|'loadedmetadata', fn). No motor web é o próprio <video>.
//   engine.load(url, { live, startAt, net, keepRetry })   começa a tocar (net: itemNet do item)
//   engine.play() / engine.pause() / engine.seek(segundos) / engine.destroy()
//   engine.audioTracks()    [{ label, lang, name, active }]   engine.setAudioTrack(i)
//   engine.subtitleTracks() [{ label, lang, name, active }]   engine.setSubtitleTrack(i | -1)
//   engine.levels()         [{ height, bitrate }]   engine.level() { auto, current }   engine.setLevel(i | -1)
//   callbacks: onError(mensagem) falha definitiva, depois das tentativas do próprio motor;
//              onBlocked() reprodução automática bloqueada; onTracks() faixas ou níveis mudaram;
//              onReload() o motor pede para recarregar o item (o player chama play de novo).
import { createWebEngine } from './engine-web.js';

const PLATFORMS = ['browser', 'android', 'tizen', 'webos'];

// O build grava a plataforma em window.__PLATFORM__. Sem build (servido pelo server.mjs), detecta.
export function detectPlatform(win) {
  const w = win || {};
  if (PLATFORMS.includes(w.__PLATFORM__)) return w.__PLATFORM__;
  if (w.Capacitor && typeof w.Capacitor.getPlatform === 'function' && w.Capacitor.getPlatform() === 'android') return 'android';
  if (w.tizen && (w.tizen.application || w.tizen.tvinputdevice)) return 'tizen';
  if (w.PalmSystem || w.webOSSystem) return 'webos';
  return 'browser';
}

export function capsFor(platform, bundled) {
  const browser = platform === 'browser';
  return {
    proxy: browser,                       // só o navegador usa o server.mjs; os apps acessam direto
    serviceWorker: browser && !bundled,   // pacotes não usam service worker
    syncWorker: platform !== 'android',   // no Android o fetch do Capacitor não alcança o worker
    browserFullscreen: browser || platform === 'android',
    exitOnBack: !browser,                 // Voltar no Início fecha o app (exigência das lojas de TV)
  };
}

const W = typeof window !== 'undefined' ? window : {};
export const PLATFORM = detectPlatform(W);
export const BUNDLED = !!W.__BUNDLED__;
export const caps = capsFor(PLATFORM, BUNDLED);
export const isNative = PLATFORM !== 'browser';

// ---- Teclas do controle remoto ----
// Códigos fixos: Samsung (10009 Voltar, 10252 Play/Pause), LG (461 Voltar), padrões HbbTV/DVB.
const KEYCODES = {
  10009: 'back', 461: 'back', 8: null,
  415: 'playpause', 19: 'playpause', 10252: 'playpause', 413: 'stop', 417: 'forward', 412: 'rewind',
  427: 'chup', 428: 'chdown', 403: 'red', 404: 'green', 405: 'yellow', 406: 'blue',
};

// Nome lógico da tecla ('up', 'enter', 'back', '0'–'9', 'playpause', 'chup'…), ou null.
export function keyName(e) {
  if (KEYCODES[e.keyCode]) return KEYCODES[e.keyCode];
  switch (e.key) {
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case 'ArrowLeft': return 'left';
    case 'ArrowRight': return 'right';
    case 'Enter': return 'enter';
    case 'Escape': case 'GoBack': case 'BrowserBack': return 'back';
    case 'Backspace': return 'backspace';
    case 'MediaPlayPause': case 'MediaPlay': case 'MediaPause': return 'playpause';
    case 'MediaStop': return 'stop';
    case 'MediaFastForward': return 'forward';
    case 'MediaRewind': return 'rewind';
    case ' ': return 'space';
    case 'PageUp': case 'ChannelUp': return 'chup';
    case 'PageDown': case 'ChannelDown': return 'chdown';
    case 'ColorF0Red': return 'red';
    case 'ColorF1Green': return 'green';
    case 'ColorF2Yellow': return 'yellow';
    case 'ColorF3Blue': return 'blue';
    default:
      if (/^\d$/.test(e.key)) return e.key;
      if (e.keyCode >= 48 && e.keyCode <= 57) return String(e.keyCode - 48);
      return null;
  }
}

// Na Samsung, teclas de mídia, números e coloridas só chegam ao app depois de registradas.
const TIZEN_KEYS = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
  'ChannelUp', 'ChannelDown', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
export function registerKeys() {
  if (PLATFORM !== 'tizen' || !W.tizen || !W.tizen.tvinputdevice) return [];
  const ok = [];
  for (const k of TIZEN_KEYS) {
    try { W.tizen.tvinputdevice.registerKey(k); ok.push(k); } catch { /* tecla inexistente neste modelo */ }
  }
  return ok;
}

// Fecha o app (apps de TV). No navegador não faz nada.
export function exitApp() {
  try {
    if (PLATFORM === 'tizen') W.tizen.application.getCurrentApplication().exit();
    else if (PLATFORM === 'webos') { if (W.webOS && W.webOS.platformBack) W.webOS.platformBack(); else W.close(); }
    else if (PLATFORM === 'android' && W.Capacitor && W.Capacitor.Plugins && W.Capacitor.Plugins.App) W.Capacitor.Plugins.App.exitApp();
  } catch { /* sem API de saída */ }
}

// Motor de reprodução da plataforma. Nesta versão, todas usam o motor web (hls.js, mpegts.js e
// <video>); os motores nativos entram nas fases de cada plataforma.
export function createEngine(video, callbacks) {
  return createWebEngine(video, callbacks);
}
