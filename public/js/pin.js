// PIN do controle parental: protege categorias bloqueadas e a organização das categorias.
// É uma barreira para o uso doméstico (crianças), não uma proteção criptográfica: o PIN fica
// guardado como hash neste aparelho, junto com os demais dados do app.
import { S, setSetting, rebuildLists } from './store.js';
import { h, modal, toast } from './ui.js';
import { hash } from './util.js';

const digest = (pin) => hash(`sintonia-pin|${pin}`);
export const hasPin = () => !!S.settings.pinHash;
export const checkPin = (pin) => hasPin() && digest(pin) === S.settings.pinHash;

function pinDialog(title, text, { confirm = false } = {}) {
  return new Promise((resolve) => {
    const inp = (label) => h('input', {
      class: 'input', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '8', 'aria-label': label, placeholder: label,
    });
    const a = inp('PIN');
    const b = confirm ? inp('Repita o PIN') : null;
    const err = h('p', { class: 'err', hidden: true });
    const ok = () => {
      const v = a.value.trim();
      if (!/^\d{4,8}$/.test(v)) { err.textContent = 'Use de 4 a 8 números.'; err.hidden = false; return; }
      if (b && b.value.trim() !== v) { err.textContent = 'Os dois PINs não são iguais.'; err.hidden = false; return; }
      m.close(v);
    };
    for (const i of [a, b].filter(Boolean)) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
    const m = modal([
      h('h2', null, title), text ? h('p', { class: 'muted small' }, text) : null, a, b, err,
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => m.close() }, 'Cancelar'),
        h('button', { class: 'btn primary', onclick: ok }, 'Confirmar')),
    ], { onClose: (v) => resolve(v || null) });
  });
}

// Pede o PIN. true quando correto (ou quando não há PIN definido).
export async function askPin(title = 'Digite o PIN') {
  if (!hasPin()) return true;
  const v = await pinDialog(title, null);
  if (v === null) return false;
  if (checkPin(v)) return true;
  toast('PIN incorreto');
  return false;
}

export async function setPinDialog() {
  if (hasPin() && !(await askPin('PIN atual'))) return false;
  const v = await pinDialog(hasPin() ? 'Novo PIN' : 'Criar PIN', 'De 4 a 8 números. Ele será pedido para abrir categorias bloqueadas e para organizar as categorias.', { confirm: true });
  if (!v) return false;
  await setSetting('pinHash', digest(v));
  toast('PIN salvo');
  return true;
}

export async function removePin() {
  if (!hasPin() || !(await askPin('PIN atual'))) return false;
  await setSetting('pinHash', '');
  S.unlocked = false;
  toast('PIN removido');
  return true;
}

// Libera as categorias bloqueadas até o app ser fechado ou bloqueado de novo.
export async function unlock() {
  if (S.unlocked) return true;
  if (!(await askPin('Categoria bloqueada'))) return false;
  S.unlocked = true;
  rebuildLists();
  return true;
}

export function lockNow() {
  S.unlocked = false;
  rebuildLists();
}
