// Navegação espacial por setas (controle remoto de TV, teclado).
const SEL = 'button:not([disabled]), [data-f], input:not([type=hidden]):not([type=file]), textarea, a[href]';
const scopes = [];

export function pushScope(fn) { scopes.push(fn); }
export function popScope(fn) { const i = scopes.lastIndexOf(fn); if (i > -1) scopes.splice(i, 1); }
export function currentScope() {
  for (let i = scopes.length - 1; i >= 0; i--) { const el = scopes[i](); if (el) return el; }
  return document.getElementById('app');
}

function candidates(root) {
  const out = [];
  for (const el of root.querySelectorAll(SEL)) {
    if (el.closest('[hidden], .no-nav')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    out.push({ el, r });
  }
  return out;
}

export function focusEl(el) {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function focusFirst(root = currentScope()) {
  const pref = root.querySelector('[data-autofocus]');
  if (pref && !pref.closest('[hidden]')) { focusEl(pref); return true; }
  const c = candidates(root)[0];
  if (c) { focusEl(c.el); return true; }
  return false;
}

document.addEventListener('focusin', (e) => {
  const g = e.target.closest?.('[data-group]');
  if (g) g._last = e.target;
});

export function move(dir) {
  const root = currentScope();
  const cur = document.activeElement;
  if (!cur || cur === document.body || !root.contains(cur)) return focusFirst(root);
  const r0 = cur.getBoundingClientRect();
  const cx = r0.left + r0.width / 2;
  const cy = r0.top + r0.height / 2;
  let best = null;
  let bestScore = Infinity;
  for (const { el, r } of candidates(root)) {
    if (el === cur || el.contains(cur) || cur.contains(el)) continue;
    const ex = r.left + r.width / 2;
    const ey = r.top + r.height / 2;
    let primary; let orth; let overlap;
    if (dir === 'right' || dir === 'left') {
      if (dir === 'right' ? !(ex > cx + 1 && r.left >= r0.left + 1) : !(ex < cx - 1 && r.right <= r0.right - 1)) continue;
      primary = dir === 'right' ? Math.max(0, r.left - r0.right) : Math.max(0, r0.left - r.right);
      overlap = Math.min(r.bottom, r0.bottom) - Math.max(r.top, r0.top);
      orth = Math.abs(ey - cy);
    } else {
      if (dir === 'down' ? !(ey > cy + 1 && r.top >= r0.top + 1) : !(ey < cy - 1 && r.bottom <= r0.bottom - 1)) continue;
      primary = dir === 'down' ? Math.max(0, r.top - r0.bottom) : Math.max(0, r0.top - r.bottom);
      overlap = Math.min(r.right, r0.right) - Math.max(r.left, r0.left);
      orth = Math.abs(ex - cx);
    }
    const score = primary + (overlap > 0 ? orth * 0.15 : orth * 2 + 400);
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (!best) return false;
  const gFrom = cur.closest('[data-group]');
  const gTo = best.closest('[data-group]');
  if (gTo && gTo !== gFrom && gTo._last && gTo._last.isConnected && gTo.contains(gTo._last) && !gTo._last.closest('[hidden]')) {
    const lr = gTo._last.getBoundingClientRect();
    if (lr.width > 0) best = gTo._last;
  }
  focusEl(best);
  return true;
}
