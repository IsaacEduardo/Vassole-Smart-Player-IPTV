// Partes comuns aos motores com player nativo (Android/ExoPlayer, Samsung/AVPlay): o vídeo é
// desenhado pelo aparelho atrás da página, e o player da página conversa com um objeto "media"
// que imita a parte de HTMLMediaElement que ele usa.

// ctl: { seek(t), setRate(r), play() -> Promise, pause() } do player nativo.
export function createMedia(ctl) {
  const listeners = new Map();
  const st = { t: 0, d: NaN, paused: true, rate: 1, ready: false, buffering: false };
  const media = {
    get currentTime() { return st.t; },
    set currentTime(v) { st.t = v; ctl.seek(v); },
    get duration() { return st.d; },
    get paused() { return st.paused; },
    get playbackRate() { return st.rate; },
    set playbackRate(r) { st.rate = r; ctl.setRate(r); },
    error: null,
    play() { st.paused = false; return Promise.resolve(ctl.play()).then(() => undefined); },
    pause() { st.paused = true; ctl.pause(); emit('pause'); },
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
  // s: { t, d (<0 = ao vivo), paused, playing, buffering, ready, rate }. Dispara os eventos de um <video>.
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
  return { media, update, emit, reset, state: st };
}

// Acompanha a posição do palco do player na tela. onRect recebe { x, y, w, h, preview } em pixels
// CSS, ou null quando não há vídeo visível. Enquanto há vídeo, o <html> ganha a classe video-on
// (fundos transparentes no CSS, para o vídeo nativo aparecer por trás).
export function createViewport(onRect) {
  let el = null;
  let raf = 0;
  function send() {
    raf = 0;
    if (!el || !el.isConnected) { onRect(null); document.documentElement.classList.remove('video-on'); return; }
    const r = el.getBoundingClientRect();
    const preview = !document.body.classList.contains('playing');
    onRect({ x: r.left, y: r.top, w: r.width, h: r.height, preview });
    document.documentElement.classList.add('video-on');
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(send); };
  window.addEventListener('resize', schedule);
  document.addEventListener('scroll', schedule, true);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
  return {
    set(next) {
      if (ro) ro.disconnect();
      el = next;
      if (el && ro) ro.observe(el);
      schedule();
    },
    schedule,
  };
}
