// Motor de reprodução do Android: ExoPlayer (plugin NativePlayer do APK), com o contrato de platform.js.
// O vídeo é desenhado pelo Android atrás da página, no retângulo do palco do player (setViewport);
// enquanto há vídeo, a página deixa transparente o fundo desse trecho (classe video-on no <html>).
import { pickKind } from './engine-web.js';
import { createMedia, createViewport } from './engine-native.js';

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

export function createAndroidEngine(video, cb = {}, plugin) {
  const M = createMedia({
    seek: (t) => plugin.seek({ t }), setRate: (rate) => plugin.setRate({ rate }), play: () => plugin.play(), pause: () => plugin.pause(),
  });
  let tracks = { audio: [], text: [], video: [], videoAuto: true };
  let token = 0;
  let retry = 0;
  let live = false;
  let loaded = false;
  let aspect = 'contain';
  let cueFn = null;

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

  // Posição do palco na tela, em pixels do aparelho (CSS px × devicePixelRatio).
  const view = createViewport((r) => {
    if (!r) { plugin.setRect({ visible: false }); return; }
    const k = window.devicePixelRatio || 1;
    plugin.setRect({
      x: Math.round(r.x * k), y: Math.round(r.y * k), w: Math.round(r.w * k), h: Math.round(r.h * k),
      visible: r.w > 0 && r.h > 0, aspect: r.preview ? 'contain' : aspect,
    });
  });

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
    setViewport(el) { view.set(el); },
    setAspect(mode) { aspect = mode || 'contain'; view.schedule(); },
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
