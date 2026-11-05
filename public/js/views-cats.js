// Organizar categorias da playlist ativa: ordem, ocultar e bloquear com PIN.
import { S, catPrefs, rebuildLists } from './store.js';
import * as db from './db.js';
import { h, icon, modal, toast } from './ui.js';
import { hasPin, askPin, setPinDialog } from './pin.js';

const KIND_NAMES = { live: 'TV ao vivo', movie: 'Filmes', series: 'Séries' };
const ADULT = /\b(adult[oa]?s?|xxx|porn\w*|18\s*\+|\+\s*18|for adults|erotic\w*|er[oó]tic[oa]s?)\b/i;

async function save(prefs) {
  S.pl.catPrefs = prefs;
  await db.put('playlists', S.pl);
  const i = S.playlists.findIndex((p) => p.id === S.pl.id);
  if (i > -1) S.playlists[i] = S.pl;
  rebuildLists();
}

// Abre o organizador. onDone é chamado ao fechar, para redesenhar a tela.
export async function organizeCategories(kind, onDone) {
  if (!S.pl || !S.data) return;
  if (hasPin() && !S.unlocked && !(await askPin('PIN para organizar as categorias'))) return;
  const base = catPrefs();
  const prefs = { hidden: [...base.hidden], locked: [...base.locked], order: { ...base.order } };
  const counts = new Map();
  for (const i of S.data.all[kind]) counts.set(i.cat, (counts.get(i.cat) || 0) + 1);
  const pos = new Map((prefs.order[kind] || []).map((id, n) => [id, n]));
  let cats = S.data.allCats[kind].filter((c) => counts.get(c.id))
    .sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e6 + a.order) - (pos.has(b.id) ? pos.get(b.id) : 1e6 + b.order));
  const key = (c) => `${kind}|${c.id}`;
  const has = (list, c) => list.includes(key(c));
  const toggle = (list, c) => { const k = key(c); const i = list.indexOf(k); if (i > -1) list.splice(i, 1); else list.push(k); };
  let changed = false;

  const listEl = h('div', { class: 'org-list', 'data-group': 'org' });
  const adult = cats.filter((c) => ADULT.test(c.name));
  const render = (focusId, focusAct) => {
    listEl.replaceChildren(...cats.map((c, n) => {
      const hid = has(prefs.hidden, c);
      const lock = has(prefs.locked, c);
      const act = (name, label, fn, on = false) => h('button', { class: `btn sm${on ? ' on' : ''}`, 'data-act': name, 'aria-label': `${label}: ${c.name}`, onclick: fn }, label);
      return h('div', { class: `org-row${hid ? ' off' : ''}`, 'data-id': c.id },
        h('span', { class: 'org-name' }, lock ? icon('lock') : null, c.name, h('span', { class: 'muted small' }, ` ${counts.get(c.id)}`)),
        h('span', { class: 'row' },
          act('up', '↑', () => move(n, -1)),
          act('down', '↓', () => move(n, 1)),
          act('hide', hid ? 'Mostrar' : 'Ocultar', () => { toggle(prefs.hidden, c); changed = true; render(c.id, 'hide'); }, hid),
          act('lock', lock ? 'Desbloquear' : 'Bloquear', async () => {
            if (!lock && !hasPin() && !(await setPinDialog())) return;
            toggle(prefs.locked, c); changed = true; render(c.id, 'lock');
          }, lock)));
    }));
    if (focusId !== undefined) listEl.querySelector(`[data-id="${CSS.escape(focusId)}"] [data-act="${focusAct}"]`)?.focus();
  };
  function move(n, d) {
    const j = n + d;
    if (j < 0 || j >= cats.length) return;
    [cats[n], cats[j]] = [cats[j], cats[n]];
    prefs.order[kind] = cats.map((c) => c.id);
    changed = true;
    render(cats[j].id, d < 0 ? 'up' : 'down');
  }
  const lockAdult = adult.length ? h('button', { class: 'btn sm', onclick: async () => {
    if (!hasPin() && !(await setPinDialog())) return;
    for (const c of adult) if (!has(prefs.locked, c)) prefs.locked.push(key(c));
    changed = true; render();
    toast(`${adult.length} categoria(s) adulta(s) bloqueada(s)`);
  } }, icon('lock'), `Bloquear categorias adultas (${adult.length})`) : null;
  const reset = h('button', { class: 'btn sm', onclick: () => {
    prefs.hidden = prefs.hidden.filter((k) => !k.startsWith(`${kind}|`));
    prefs.locked = prefs.locked.filter((k) => !k.startsWith(`${kind}|`));
    delete prefs.order[kind];
    cats = S.data.allCats[kind].filter((c) => counts.get(c.id)).sort((a, b) => a.order - b.order);
    changed = true; render();
  } }, 'Restaurar padrão');

  render();
  const m = modal([
    h('h2', null, `Categorias: ${KIND_NAMES[kind]}`),
    h('p', { class: 'muted small' }, 'Ocultar tira a categoria e os itens dela das listas e da busca. Bloquear pede o PIN para abrir.'),
    h('div', { class: 'row' }, lockAdult, reset),
    listEl,
    h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: () => m.close() }, 'Concluir')),
  ], {
    cls: 'wide org',
    onClose: async () => {
      if (!changed) return;
      await save(prefs);
      toast('Categorias salvas');
      onDone?.();
    },
  });
}
