// Complementos para navegadores de TV antigos (Samsung Tizen 4+ / LG webOS 4+, Chromium 53–79).
// Cada um só é definido quando falta; em navegadores atuais este arquivo não altera nada.
/* eslint-disable no-extend-native */

const define = (proto, name, fn) => {
  if (proto && !proto[name]) Object.defineProperty(proto, name, { value: fn, configurable: true, writable: true });
};

// Chromium 86
if (typeof Element !== 'undefined') {
  const replaceChildren = function replaceChildren(...nodes) {
    while (this.firstChild) this.removeChild(this.firstChild);
    this.append(...nodes);
  };
  define(Element.prototype, 'replaceChildren', replaceChildren);
  define(DocumentFragment.prototype, 'replaceChildren', replaceChildren);
}

// Chromium 57
define(String.prototype, 'padStart', function padStart(len, fill = ' ') {
  const s = String(this);
  if (s.length >= len || !fill) return s;
  const need = len - s.length;
  return String(fill).repeat(Math.ceil(need / String(fill).length)).slice(0, need) + s;
});
define(String.prototype, 'padEnd', function padEnd(len, fill = ' ') {
  const s = String(this);
  if (s.length >= len || !fill) return s;
  const need = len - s.length;
  return s + String(fill).repeat(Math.ceil(need / String(fill).length)).slice(0, need);
});

// Chromium 69
define(Array.prototype, 'flat', function flat(depth = 1) {
  return depth < 1 ? Array.prototype.slice.call(this)
    : Array.prototype.reduce.call(this, (acc, v) => acc.concat(Array.isArray(v) ? v.flat(depth - 1) : [v]), []);
});
define(Array.prototype, 'flatMap', function flatMap(fn, thisArg) {
  return Array.prototype.map.call(this, fn, thisArg).flat(1);
});

// Chromium 73
define(String.prototype, 'matchAll', function matchAll(re) {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const rx = new RegExp(re.source, flags);
  const str = String(this);
  const out = [];
  let m;
  while ((m = rx.exec(str))) {
    out.push(m);
    if (m[0] === '') rx.lastIndex++;
  }
  return out[Symbol.iterator]();
});
