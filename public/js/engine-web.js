// Motor de reprodução web: HLS (hls.js), MPEG-TS (mpegts.js) e <video> nativo (MP4/WebM/MKV).
// Com { nativeHls: true } (TVs LG), o HLS vai direto ao <video>, que usa o decodificador da TV
// (HEVC, AC-3); se a TV recusar o stream, aquele endereço passa a tocar pelo hls.js.
// Segue o contrato descrito em platform.js. As tentativas de recuperação ficam aqui; o player
// só recebe a falha definitiva (onError) ou o pedido de recarregar o item (onReload).
import { toNet } from './net.js';

// Carrega hls.js e mpegts.js (vendor/) só quando o primeiro stream do tipo aparece.
const scripts = new Map();
function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => { scripts.delete(src); rej(new Error(`Falha ao carregar ${src}`)); };
      document.head.appendChild(s);
    }));
  }
  return scripts.get(src);
}

// Tipo do stream: pela extensão ou, sem ela, pelos primeiros bytes ('hls' | 'mpegts' | 'native').
export async function pickKind(url, isLive, net) {
  let path = url.toLowerCase();
  try { path = new URL(url).pathname.toLowerCase(); } catch { /* */ }
  if (/\.m3u8?$/.test(path)) return 'hls';
  if (/\.ts$/.test(path)) return 'mpegts';
  if (/\.(mp4|m4v|webm|mov|mkv|ogv|mp3|aac|m4a)$/.test(path)) return 'native';
  // Extensão desconhecida: lê os primeiros bytes para decidir.
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = setTimeout(() => { if (ac) ac.abort(); }, 8000);
  try {
    const r = await fetch(toNet(url, net), { signal: ac ? ac.signal : undefined, headers: { Range: 'bytes=0-2047' } });
    const ct = r.headers.get('content-type') || '';
    const { value } = await r.body.getReader().read();
    if (ac) ac.abort();
    if (/mpegurl/i.test(ct)) return 'hls';
    if (value && new TextDecoder().decode(value.slice(0, 32)).includes('#EXTM3U')) return 'hls';
    if (value && value[0] === 0x47) return 'mpegts';
    if (/mp2t/i.test(ct)) return 'mpegts';
    if (/^(video|audio)\//i.test(ct)) return 'native';
  } catch { /* segue o padrão */ } finally { clearTimeout(t); }
  return isLive ? 'mpegts' : 'native';
}

const call = (fn, ...a) => { if (typeof fn === 'function') fn(...a); };

// Endereços HLS que o <video> da TV recusou: passam a usar o hls.js nesta sessão.
const hlsJsOnly = new Set();

// pauseHidden (TVs LG): pausa quando o app vai para segundo plano; ao voltar, o VOD continua e o
// ao vivo é recarregado (para voltar ao ponto atual da transmissão).
export function createWebEngine(video, cb = {}, { nativeHls = false, pauseHidden = false } = {}) {
  let hls = null;
  let hlsNative = false; // HLS tocando direto no <video> (player da TV)
  let current = null;    // último load(): { url, opts }
  let mts = null;
  let kind = '';      // 'hls' | 'mpegts' | 'native' | '' (parado)
  let token = 0;
  let retry = 0;
  let live = false;
  const external = new WeakSet(); // legendas externas (<track> do app), fora da lista do stream

  video.addEventListener('playing', () => { retry = 0; });
  let resumeOnShow = false;
  if (pauseHidden) {
    document.addEventListener('visibilitychange', () => {
      if (!kind) return;
      if (document.hidden) {
        resumeOnShow = !video.paused;
        if (resumeOnShow) video.pause();
      } else if (resumeOnShow) {
        resumeOnShow = false;
        if (live) call(cb.onReload); else tryPlay();
      }
    });
  }
  video.addEventListener('error', () => {
    if (kind !== 'native') return;
    const c = video.error && video.error.code;
    if (hlsNative) { onNativeHlsError(c); return; }
    call(cb.onError, c === 4 ? 'Formato ou codec não suportado por este navegador.'
      : c === 3 ? 'Erro ao decodificar o vídeo.' : 'Não foi possível carregar o vídeo.');
  });

  function teardown() {
    kind = '';
    if (hls) { try { hls.destroy(); } catch { /* */ } hls = null; }
    if (mts) {
      try { mts.pause(); mts.unload(); mts.detachMediaElement(); mts.destroy(); } catch { /* */ }
      mts = null;
    }
    video.removeAttribute('src');
    try { video.load(); } catch { /* */ }
  }

  function tryPlay() {
    const pr = video.play();
    if (pr) pr.catch((e) => { if (e.name === 'NotAllowedError') call(cb.onBlocked); });
  }

  function onHlsError(d, tk) {
    if (tk !== token || !d.fatal) return;
    const Hls = window.Hls;
    // Manifesto que não carregou: startLoad() não o pede de novo. Erro 4xx falha na hora (e o player
    // passa para outra versão do canal); outros erros (rede, tempo esgotado) recarregam uma vez.
    if (/manifest/i.test(d.details || '')) {
      const code = (d.response && d.response.code) || 0;
      if (!(code >= 400 && code < 500) && retry < 1) {
        retry++;
        setTimeout(() => { if (tk === token) call(cb.onReload); }, 1500);
        return;
      }
    } else if (d.type === Hls.ErrorTypes.NETWORK_ERROR && retry < 3) {
      retry++;
      setTimeout(() => { if (tk === token && hls) hls.startLoad(); }, 1200 * retry);
      return;
    }
    if (d.type === Hls.ErrorTypes.MEDIA_ERROR && retry < 2) { retry++; hls.recoverMediaError(); return; }
    const codec = /codec|incompatible/i.test(d.details || '');
    const manifest = /manifest/i.test(d.details || '');
    call(cb.onError, codec ? 'Codec não suportado por este navegador (ex.: HEVC ou AC-3).'
      : manifest ? `O stream não respondeu (${(d.response && d.response.code) || d.details}). Verifique a conta, o proxy ou o formato ao vivo nos Ajustes.`
        : `Falha na reprodução (${d.details}).`);
  }

  // HLS no <video> da TV: formato recusado → hls.js; rede → recarrega (2× ao vivo, 1× VOD).
  function onNativeHlsError(code) {
    const tk = token;
    const again = current;
    if (code === 4 && again && !hlsJsOnly.has(again.url)) {
      hlsJsOnly.add(again.url);
      api.load(again.url, { ...again.opts, keepRetry: true });
      return;
    }
    if (retry < (live ? 2 : 1)) {
      retry++;
      setTimeout(() => { if (tk === token) call(cb.onReload); }, 1500);
      return;
    }
    call(cb.onError, code === 4 ? 'A TV não reproduz este stream.' : 'O stream não respondeu ou parou de enviar vídeo.');
  }

  function onMtsError(type, detail, tk) {
    if (tk !== token) return;
    if (retry < 2 && live) {
      retry++;
      setTimeout(() => { if (tk === token) call(cb.onReload); }, 1500);
      return;
    }
    call(cb.onError, `Falha na reprodução (${type}${detail ? `: ${detail}` : ''}).`);
  }

  // Legendas do stream: as do HLS ou as faixas de texto do <video> (sem as externas do app).
  const nativeSubs = () => Array.from(video.textTracks || [])
    .filter((t) => (t.kind === 'subtitles' || t.kind === 'captions') && !external.has(t));

  const api = {
    media: video,
    get kind() { return kind; },

    async load(url, { live: isLive = false, startAt = 0, net, keepRetry = false } = {}) {
      const tk = ++token;
      teardown();
      hlsNative = false;
      current = { url, opts: { live: isLive, startAt, net } };
      live = isLive;
      if (!keepRetry) retry = 0;
      const k = await pickKind(url, isLive, net);
      if (tk !== token) return;
      const src = toNet(url, net);
      try {
        if (k === 'hls' && nativeHls && !hlsJsOnly.has(url) && video.canPlayType('application/vnd.apple.mpegurl')) {
          kind = 'native';
          hlsNative = true;
        } else if (k === 'hls') {
          await loadScript('vendor/hls.min.js');
          if (tk !== token) return;
          const Hls = window.Hls;
          if (Hls && Hls.isSupported()) {
            kind = 'hls';
            hls = new Hls({ enableWorker: true, backBufferLength: isLive ? 10 : 60, maxBufferLength: 30, liveDurationInfinity: true, startPosition: startAt || -1 });
            hls.on(Hls.Events.ERROR, (_, d) => onHlsError(d, tk));
            hls.on(Hls.Events.MANIFEST_PARSED, () => { tryPlay(); call(cb.onTracks); });
            hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => call(cb.onTracks));
            hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => call(cb.onTracks));
            hls.on(Hls.Events.LEVELS_UPDATED, () => call(cb.onTracks));
            hls.loadSource(src);
            hls.attachMedia(video);
            return;
          }
          if (!video.canPlayType('application/vnd.apple.mpegurl')) throw new Error('Este navegador não reproduz HLS.');
        } else if (k === 'mpegts') {
          await loadScript('vendor/mpegts.js');
          if (tk !== token) return;
          const m = window.mpegts;
          if (m && m.getFeatureList().mseLivePlayback) {
            kind = 'mpegts';
            const p = m.createPlayer({ type: 'mpegts', isLive, url: src }, {
              enableWorker: true, lazyLoad: false, liveBufferLatencyChasing: isLive, autoCleanupSourceBuffer: true,
            });
            mts = p;
            p.on(m.Events.ERROR, (type, detail) => onMtsError(type, detail, tk));
            p.attachMediaElement(video);
            p.load();
            tryPlay();
            return;
          }
        }
        kind = 'native';
        video.src = src;
        if (startAt) video.addEventListener('loadedmetadata', () => { video.currentTime = startAt; }, { once: true });
        tryPlay();
      } catch (e) {
        call(cb.onError, e.message);
      }
    },

    play: tryPlay,
    pause() { video.pause(); },
    seek(t) { video.currentTime = t; },
    destroy() { token++; teardown(); },

    audioTracks() {
      if (hls) return hls.audioTracks.map((t, i) => ({ label: t.name || t.lang || `Faixa ${i + 1}`, lang: t.lang || '', name: t.name || '', active: hls.audioTrack === i }));
      return Array.from(video.audioTracks || []).map((t, i) => ({ label: t.label || t.language || `Faixa ${i + 1}`, lang: t.language || '', name: t.label || '', active: t.enabled }));
    },
    setAudioTrack(i) {
      if (hls) hls.audioTrack = i;
      else Array.from(video.audioTracks || []).forEach((t, j) => { t.enabled = j === i; });
    },

    subtitleTracks() {
      if (hls && hls.subtitleTracks.length) {
        return hls.subtitleTracks.map((t, i) => ({ label: t.name || t.lang || `Legenda ${i + 1}`, lang: t.lang || '', name: t.name || '', active: hls.subtitleTrack === i && hls.subtitleDisplay !== false }));
      }
      return nativeSubs().map((t, i) => ({ label: t.label || t.language || `Legenda ${i + 1}`, lang: t.language || '', name: t.label || '', active: t.mode === 'showing' }));
    },
    setSubtitleTrack(i) {
      if (hls && hls.subtitleTracks.length) {
        hls.subtitleTrack = i;
        hls.subtitleDisplay = i > -1;
        // Desligar também apaga legendas embutidas no vídeo (CEA-608) que o hls.js expõe à parte.
        if (i === -1) nativeSubs().forEach((t) => { if (t.mode === 'showing') t.mode = 'disabled'; });
        return;
      }
      nativeSubs().forEach((t, j) => { t.mode = j === i ? 'showing' : 'disabled'; });
    },
    // Legendas externas são desenhadas pelo app no próprio <video>; o motor não as lista.
    markExternal(track) { if (track) external.add(track); },

    levels() { return hls ? hls.levels.map((l) => ({ height: l.height || 0, bitrate: l.bitrate || 0 })) : []; },
    level() { return hls ? { auto: hls.autoLevelEnabled, current: hls.currentLevel } : { auto: true, current: -1 }; },
    setLevel(i) { if (hls) hls.currentLevel = i; },
  };
  return api;
}
