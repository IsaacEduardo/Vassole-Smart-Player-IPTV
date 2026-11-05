// Utilitários de interface: criação de elementos, ícones, formatação, avisos e diálogos.
import { focusFirst, pushScope, popScope } from './nav.js';

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const P = {
  home: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  live: 'M4 7h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm4-4 4 4 4-4',
  guide: 'M3 5h18M3 12h18M3 19h18M8 3v4M15 10v4M11 17v4',
  movie: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4',
  series: 'M6 3h12v4H6zM4 9h16v12H4zM10 13l5 2.5-5 2.5z',
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5 21 21',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  gear: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  play: 'M7 4.5v15l13-7.5z',
  pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
  back10: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4M10 9.5v5M13 10.5a1.5 1.5 0 0 1 3 0v3a1.5 1.5 0 0 1-3 0z',
  fwd10: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4M8 9.5v5M11 10.5a1.5 1.5 0 0 1 3 0v3a1.5 1.5 0 0 1-3 0z',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  audio: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  cc: 'M3 5h18v14H3zM10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3',
  aspect: 'M3 6h18v12H3zM7 10V9h3M17 14v1h-3',
  full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  close: 'M5 5l14 14M19 5 5 19',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  check: 'M5 12.5l4.5 4.5L19 7',
  info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v6M12 7.5v.01',
};
export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `ic ${cls}`);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', P[name] || '');
  svg.appendChild(path);
  return svg;
}

export function img(src, alt = '', cls = '') {
  const el = h('img', { class: cls, alt, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', draggable: 'false' });
  if (src) {
    el.src = location.protocol === 'https:' && src.startsWith('http:') ? `/proxy?u=${encodeURIComponent(src)}` : src;
    el.onerror = () => { el.removeAttribute('src'); el.classList.add('noimg'); };
  } else el.classList.add('noimg');
  return el;
}

export const fmtClock = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export const fmtDate = (t) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  sec = Math.floor(sec);
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = String(sec % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}
export function ago(t) {
  if (!t) return 'nunca';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const hh = Math.round(m / 60);
  if (hh < 48) return `há ${hh} h`;
  return `há ${Math.round(hh / 24)} dias`;
}

let toastTimer;
export function toast(msg, ms = 3200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// Diálogo genérico. Devolve { el, close }.
const modals = [];
export function modal(content, { onClose, cls = '' } = {}) {
  const prev = document.activeElement;
  const box = h('div', { class: `modal-box ${cls}`, role: 'dialog', 'aria-modal': 'true' }, content);
  const back = h('div', { class: 'modal' }, box);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.body.appendChild(back);
  const scope = () => box;
  pushScope(scope);
  let closed = false;
  function close(val) {
    if (closed) return;
    closed = true;
    back.remove();
    popScope(scope);
    modals.splice(modals.indexOf(api), 1);
    onClose?.(val);
    if (prev && prev.isConnected) prev.focus({ preventScroll: true });
  }
  const api = { el: box, close };
  modals.push(api);
  requestAnimationFrame(() => focusFirst(box));
  return api;
}
export function closeTopModal() {
  const m = modals[modals.length - 1];
  if (!m) return false;
  m.close();
  return true;
}

export function confirmDialog(title, text, okLabel = 'Confirmar', danger = false) {
  return new Promise((resolve) => {
    const m = modal([
      h('h2', null, title),
      text ? h('p', { class: 'muted' }, text) : null,
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => m.close(false) }, 'Cancelar'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => m.close(true) }, okLabel)),
    ], { onClose: (v) => resolve(!!v) });
    requestAnimationFrame(() => m.el.querySelector('.btn:last-child').focus());
  });
}

// Lista de opções. options: [{label, value, active}]
export function choose(title, options) {
  return new Promise((resolve) => {
    const m = modal([
      h('h2', null, title),
      h('div', { class: 'choices' }, options.map((o) => h('button', {
        class: `choice${o.active ? ' active' : ''}`,
        onclick: () => m.close({ value: o.value }),
      }, o.active ? icon('check') : h('span', { class: 'ic' }), o.label))),
    ], { onClose: (v) => resolve(v ? v.value : undefined) });
    requestAnimationFrame(() => (m.el.querySelector('.choice.active') || m.el.querySelector('.choice'))?.focus());
  });
}

// Botões segmentados (substituem <select>, que conflita com as setas do controle remoto).
export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup' });
  const render = () => {
    wrap.replaceChildren(...options.map((o) => h('button', {
      class: o.value === value ? 'on' : '',
      role: 'radio',
      'aria-checked': String(o.value === value),
      onclick: () => { value = o.value; render(); wrap.querySelector('.on')?.focus(); onChange(o.value); },
    }, o.label)));
  };
  render();
  return wrap;
}

// Renderiza listas longas aos poucos, conforme a rolagem se aproxima do fim.
export function chunked(container, items, render, { size = 120, root = null } = {}) {
  let i = 0;
  const sentinel = h('div', { class: 'sentinel' });
  // Só usa o contêiner como raiz se ele de fato rolar; senão, a janela (com recorte dos ancestrais).
  if (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY || '')) root = null;
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) more(); }, { root, rootMargin: '800px' });
  function more() {
    if (i >= items.length) return;
    const frag = document.createDocumentFragment();
    const end = Math.min(items.length, i + size);
    for (; i < end; i++) frag.appendChild(render(items[i], i));
    container.appendChild(frag);
    if (i < items.length) container.appendChild(sentinel);
    else { sentinel.remove(); io.disconnect(); }
  }
  more();
  if (i < items.length) io.observe(sentinel);
  return {
    ensure(idx) { while (i <= idx && i < items.length) more(); },
    destroy() { io.disconnect(); },
  };
}

const scripts = new Map();
export function loadScript(src) {
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

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
