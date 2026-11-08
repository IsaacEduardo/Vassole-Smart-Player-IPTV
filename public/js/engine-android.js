// Motor de reprodução do Android: ExoPlayer (plugin NativePlayer do APK), com o contrato de platform.js.
// O vídeo é desenhado pelo Android atrás da página, no retângulo do palco do player (setViewport);
// enquanto há vídeo, a página deixa transparente o fundo desse trecho (classe video-on no <html>).
import { pickKind } from './engine-web.js';

const call = (fn, ...a) => { if (typeof fn === 'function') fn(...a); };

// Mensagem para o usuário a partir do erro do ExoPlayer (o código fica entre parênteses para suporte).
function errorMessage(e) {
  const code = String(e.name || '').replace('ERROR_CODE_', '');
  if (e.category === 'decoder') return `Este aparelho não decodifica o formato deste stream (${code}).`;
  if (e.name === 'ERROR_CODE_IO_BAD_HTTP_STATUS') return `O provedor recusou o stream (${code}). Verifique a conta ou o formato ao vivo nos Ajustes.`;
  if (e.category === 'network') return `O stream não respondeu ou parou de enviar vídeo (${code}).`;
  if (e.category === 'source') return `Formato do stream não reconhecido (${code}).`;
  return `Falha na reprodução (${code || e.message}).`;
}

// Objeto com a parte de HTMLMediaElement que o player usa (tempo, pausa, eventos).
function createMedia(plugin) {
  const listeners = new Map();
  const st = { t: 0, d: NaN, paused: true, rate: 1, ready: false, buffering: false };
  const media = {
    get currentTime() { return st.t; },
    set currentTime(v) { st.t = v; plugin.seek({ t: v }); },
    get duration() { return st.d; },
    get paused() { return st.paused; },
    get playbackRate() { return st.rate; },
    set playbackRate(r) { st.rate = r; plugin.setRate({ rate: r }); },
    error: null,
    play() { st.paused = false; return plugin.play().then(() => undefined); },
    pause() { st.paused = true; plugin.pause(); emit('pause'); },
    addEventListener(type, fn, opts) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      const once = opts && opts.once;
      const wrapped = once ? (e) => { listeners.get(type).delete(wrapped); fn(e); } : fn;
      listeners.get(type).add(wrapped);
    },
    removeEventListener(type, fn) { if (listeners.has(type)) listeners.get(type).delete(fn); },
  };
  function emit(type) {
    for (const fn of [...(listeners.get(type) || [])]) { try { fn({ type, target: media }); } catch (e) { console.error(e); } }
  }
  // Estado vindo do Android a cada 250 ms; dispara os mesmos eventos de um <video>.
  function update(s) {
    const wasPaused = st.paused;
    const wasReady = st.ready;
    const wasBuffering = st.buffering;
    st.t = s.t;
    st.d = s.d < 0 ? Infinity : s.d;
    st.paused = s.paused;
    st.rate = s.rate;
    st.ready = s.ready;
    st.buffering = s.buffering;
    if (s.ready && !wasReady) { emit('loadedmetadata'); emit('canplay'); }
    if (s.buffering && !wasBuffering) emit('waiting');
    if (!s.buffering && wasBuffering && s.ready) emit('canplay');
    if (s.playing && (wasPaused || !wasReady || wasBuffering)) emit('playing');
    if (s.paused && !wasPaused) emit('pause');
    emit('timeupdate');
  }
  function reset() { st.t = 0; st.d = NaN; st.paused = true; st.ready = false; st.buffering = false; }
  return { media, update, emit, reset };
}

export function createAndroidEngine(video, cb = {}, plugin) {
  const M = createMedia(plugin);
  let tracks = { audio: [], text: [], video: [], videoAuto: true };
  let token = 0;
  let retry = 0;
  let live = false;
  let loaded = false;
  let viewport = null;
  let aspect = 'contain';
  let cueFn = null;
  let raf = 0;

  plugin.addListener('state', (s) => { if (loaded) M.update(s); });
  plugin.addListener('ended', () => { if (loaded && !live) M.emit('ended'); });
  plugin.addListener('tracks', (t) => { tracks = t; call(cb.onTracks); });
  plugin.addListener('cues', (c) => { if (cueFn) cueFn(c.texts || []); });
  plugin.addListener('error', (e) => {
    if (!loaded) return;
    const tk = token;
    // Rede ou stream: tenta de novo (ao vivo, 2 vezes; arquivos, 1). Resposta HTTP de erro (404,
    // 403…) e codec não suportado falham na hora, para o player passar logo a outra versão do canal.
    const httpError = e.name === 'ERROR_CODE_IO_BAD_HTTP_STATUS' || e.name === 'ERROR_CODE_IO_FILE_NOT_FOUND';
    if (!httpError && (e.category === 'network' || e.category === 'source') && retry < (live ? 2 : 1)) {
      retry++;
      setTimeout(() => { if (tk === token) call(cb.onReload); }, 1500);
      return;
    }
    call(cb.onError, errorMessage(e));
  });

  // Posição do palco na tela (em pixels do aparelho), atualizada em mudanças de layout e rolagem.
  function sendRect() {
    raf = 0;
    if (!viewport || !viewport.isConnected) { plugin.setRect({ visible: false }); document.documentElement.classList.remove('video-on'); return; }
    const r = viewport.getBoundingClientRect();
    const k = window.devicePixelRatio || 1;
    const preview = !document.body.classList.contains('playing');
    plugin.setRect({
      x: Math.round(r.left * k), y: Math.round(r.top * k), w: Math.round(r.width * k), h: Math.round(r.height * k),
      visible: r.width > 0 && r.height > 0, aspect: preview ? 'contain' : aspect,
    });
    document.documentElement.classList.add('video-on');
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(sendRect); };
  window.addEventListener('resize', schedule);
  document.addEventListener('scroll', schedule, true);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;

  const idx = (list, i) => list[i] || null;

  return {
    media: M.media,
    nativeVideo: true,
    get kind() { return loaded ? 'native' : ''; },

    async load(url, { live: isLive = false, startAt = 0, net = {}, keepRetry = false } = {}) {
      const tk = ++token;
      live = isLive;
      if (!keepRetry) retry = 0;
      loaded = true;
      M.reset();
      tracks = { audio: [], text: [], video: [], videoAuto: true };
      const kind = await pickKind(url, isLive, net); // HLS sem extensão precisa da dica de tipo
      if (tk !== token) return;
      try {
        await plugin.load({ url, kind, ua: net.ua || '', ref: net.ref || '', startAt });
      } catch (e) {
        call(cb.onError, (e && e.message) || 'Falha ao iniciar o player.');
      }
    },
    play() { M.media.play().catch(() => {}); },
    pause() { M.media.pause(); },
    seek(t) { M.media.currentTime = t; },
    destroy() {
      token++;
      loaded = false;
      M.reset();
      plugin.stop().catch(() => {});
      if (cueFn) cueFn([]);
    },

    // Onde o vídeo aparece: o palco do player (prévia ou tela cheia); null esconde.
    setViewport(el) {
      if (ro) ro.disconnect();
      viewport = el;
      if (el && ro) ro.observe(el);
      schedule();
    },
    setAspect(mode) { aspect = mode || 'contain'; schedule(); },
    setCueListener(fn) { cueFn = fn; },

    audioTracks() { return tracks.audio.map((t, i) => ({ label: t.name || t.lang || `Faixa ${i + 1}`, lang: t.lang, name: t.name, active: t.active })); },
    setAudioTrack(i) { const t = idx(tracks.audio, i); if (t) plugin.selectTrack({ type: 'audio', g: t.g, i: t.i }); },
    subtitleTracks() { return tracks.text.map((t, i) => ({ label: t.name || t.lang || `Legenda ${i + 1}`, lang: t.lang, name: t.name, active: t.active })); },
    setSubtitleTrack(i) {
      const t = idx(tracks.text, i);
      if (i < 0 || !t) { plugin.selectTrack({ type: 'text', off: true }); if (cueFn) cueFn([]); return; }
      plugin.selectTrack({ type: 'text', g: t.g, i: t.i });
    },
    markExternal() {},

    levels() { return tracks.video.map((t) => ({ height: t.height, bitrate: t.bitrate })); },
    level() { return { auto: tracks.videoAuto, current: tracks.video.findIndex((t) => t.active) }; },
    setLevel(i) {
      const t = idx(tracks.video, i);
      if (i < 0 || !t) plugin.selectTrack({ type: 'video', auto: true });
      else plugin.selectTrack({ type: 'video', g: t.g, i: t.i });
    },
  };
}
