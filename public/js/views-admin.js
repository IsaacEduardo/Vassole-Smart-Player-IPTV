// Telas de playlists e ajustes.
import { S, setSetting, loadPlaylists, activate, computeNet, detectProxy } from './store.js';
import { h, icon, ago, fmtDate, toast, modal, confirmDialog, segmented } from './ui.js';
import { runTask, isRunning } from './tasks.js';
import { xtreamFromUrl, normalizeServer } from './xtream.js';
import { focusFirst } from './nav.js';
import * as db from './db.js';
import { add } from './views-common.js';
import { applyCueStyle } from './subs.js';
import { LANGS } from './lang.js';

// Backup em JSON: playlists (com credenciais), favoritos, histórico e ajustes.
export async function exportBackup() {
  const [playlists, favorites, hist, settings] = await Promise.all([db.getAll('playlists'), db.getAll('favorites'), db.getAll('history'), db.getAll('settings')]);
  const data = { app: 'sintonia', version: 1, exported: new Date().toISOString(), playlists: playlists.map(({ fileText, ...p }) => ({ ...p, fileText: fileText && fileText.length < 5e6 ? fileText : undefined })), favorites, history: hist, settings };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `sintonia-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

let rerender = () => {};
export function setRerender(fn) { rerender = fn; }

export async function syncAndReload(pid, { epg = true, quiet = false } = {}) {
  const pl = S.playlists.find((p) => p.id === pid);
  const label = pl ? pl.name : 'Playlist';
  try {
    const r = await runTask('playlist', pid, `Atualizando ${label}`);
    await loadPlaylists();
    if (S.pl?.id === pid || !S.pl) await activate(pid);
    if (!quiet) toast(`${label}: ${r.counts.live} canais, ${r.counts.movie} filmes, ${r.counts.series} séries`);
  } catch (e) {
    const p = await db.get('playlists', pid);
    if (p) { p.error = e.message; await db.put('playlists', p); }
    await loadPlaylists();
    toast(`Falha ao atualizar ${label}: ${e.message}`, 6000);
    return false;
  }
  if (epg) syncEpg(pid, { quiet: true });
  return true;
}

export async function syncEpg(pid, { quiet = false } = {}) {
  const pl = S.playlists.find((p) => p.id === pid);
  if (!pl || (!pl.epgUrl && pl.type !== 'xtream')) return false;
  try {
    const r = await runTask('epg', pid, `Guia de ${pl.name}`);
    await loadPlaylists();
    if (S.pl?.id === pid) {
      S.pl = S.playlists.find((p) => p.id === pid);
      const a = await db.get('epg', [pid, '\u0001alias']);
      S.alias = a?.map || {};
      S.epgCache.clear();
    }
    if (!quiet) toast(`Guia atualizado: ${r.channels} canais, ${r.programmes} programas`);
    return true;
  } catch (e) {
    if (!quiet) toast(`Falha no guia: ${e.message}`, 6000);
    return false;
  }
}

function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'field-hint' }, hint) : null);
}

function playlistForm(existing) {
  return new Promise((resolve) => {
    let type = existing ? (existing.type === 'xtream' ? 'xtream' : existing.fileText ? 'file' : 'm3u') : 'xtream';
    const v = existing || {};
    const inp = (name, attrs = {}) => h('input', { class: 'input', name, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', ...attrs });
    const f = {
      name: inp('name', { value: v.name || '', placeholder: 'Ex.: Minha TV' }),
      server: inp('server', { value: v.server || '', placeholder: 'http://servidor:porta', inputmode: 'url' }),
      username: inp('username', { value: v.username || '' }),
      password: inp('password', { value: v.password || '', type: 'password' }),
      url: inp('url', { value: v.url || '', placeholder: 'http://…/playlist.m3u', inputmode: 'url' }),
      file: h('input', { class: 'input', type: 'file', accept: '.m3u,.m3u8,audio/x-mpegurl,application/x-mpegurl,text/plain' }),
      epg: inp('epg', { value: v.epgUrl || '', placeholder: 'Opcional: http://…/guia.xml ou .xml.gz', inputmode: 'url' }),
    };
    const fileBtn = h('button', { class: 'btn', type: 'button', onclick: () => f.file.click() }, v.fileName ? `Arquivo: ${v.fileName}` : 'Escolher arquivo…');
    f.file.hidden = true;
    f.file.addEventListener('change', () => { fileBtn.textContent = f.file.files[0] ? `Arquivo: ${f.file.files[0].name}` : 'Escolher arquivo…'; });
    const err = h('p', { class: 'err', hidden: true });
    const fields = h('div', { class: 'fields' });
    const render = () => {
      const parts = [field('Nome', f.name)];
      if (type === 'xtream') parts.push(field('Servidor', f.server, 'Endereço com porta, como fornecido pelo provedor.'), field('Usuário', f.username), field('Senha', f.password));
      if (type === 'm3u') parts.push(field('Link da playlist M3U', f.url, 'Links get.php com usuário e senha são convertidos para Xtream automaticamente.'));
      if (type === 'file') parts.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Arquivo M3U'), fileBtn, f.file));
      parts.push(field(type === 'xtream' ? 'Guia XMLTV alternativo' : 'Guia XMLTV (EPG)', f.epg, type === 'xtream' ? 'Deixe vazio para usar o guia do próprio servidor.' : 'Se vazio, usa o endereço indicado na playlist (url-tvg).'));
      fields.replaceChildren(...parts);
    };
    const seg = segmented([
      { value: 'xtream', label: 'Xtream Codes' }, { value: 'm3u', label: 'Link M3U' }, { value: 'file', label: 'Arquivo M3U' },
    ], type, (val) => { type = val; render(); });
    render();

    const save = async () => {
      err.hidden = true;
      const pl = existing ? { ...existing } : { id: `p${Date.now().toString(36)}`, createdAt: Date.now() };
      pl.name = f.name.value.trim();
      pl.epgUrl = f.epg.value.trim();
      let t = type;
      const m3uUrl = f.url.value.trim();
      const asX = t === 'm3u' ? xtreamFromUrl(m3uUrl) : null;
      if (asX) { t = 'xtream'; Object.assign(pl, asX); toast('Link reconhecido como conta Xtream'); }
      try {
        if (t === 'xtream') {
          if (!asX) {
            pl.server = normalizeServer(f.server.value);
            pl.username = f.username.value.trim();
            pl.password = f.password.value;
          }
          if (!pl.server || !pl.username || !pl.password) throw new Error('Preencha servidor, usuário e senha.');
          pl.type = 'xtream';
          delete pl.url; delete pl.fileText; delete pl.fileName;
          if (!pl.name) pl.name = new URL(pl.server).hostname;
        } else if (t === 'm3u') {
          if (!/^https?:\/\//i.test(m3uUrl)) throw new Error('Informe um link http:// ou https://.');
          pl.type = 'm3u'; pl.url = m3uUrl;
          delete pl.fileText; delete pl.fileName; delete pl.server; delete pl.username; delete pl.password; delete pl.account;
          if (!pl.name) pl.name = new URL(m3uUrl).hostname;
        } else {
          const file = f.file.files[0];
          if (!file && !existing?.fileText) throw new Error('Escolha um arquivo .m3u.');
          if (file) { pl.fileText = await file.text(); pl.fileName = file.name; }
          pl.type = 'm3u';
          delete pl.url; delete pl.server; delete pl.username; delete pl.password; delete pl.account;
          if (!pl.name) pl.name = (pl.fileName || 'Playlist').replace(/\.m3u8?$/i, '');
        }
      } catch (e) {
        err.textContent = e.message; err.hidden = false; return;
      }
      await db.put('playlists', pl);
      m.close(pl);
    };

    const m = modal([
      h('h2', null, existing ? 'Editar playlist' : 'Adicionar playlist'),
      seg, fields, err,
      h('p', { class: 'muted small' }, 'Os dados ficam somente neste aparelho. O Sintonia não fornece canais: use as fontes do seu provedor.'),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => m.close() }, 'Cancelar'),
        h('button', { class: 'btn primary', onclick: save }, existing ? 'Salvar' : 'Adicionar e carregar')),
    ], { cls: 'wide', onClose: (pl) => resolve(pl) });
  });
}

export async function addPlaylist() {
  const pl = await playlistForm(null);
  if (!pl) return;
  await loadPlaylists();
  rerender();
  const ok = await syncAndReload(pl.id);
  if (ok) { await activate(pl.id); location.hash = '#/home'; } else rerender();
}

export async function viewPlaylists(root, args) {
  add(root, h('header', { class: 'page-head' },
    h('div', null, h('h1', null, 'Playlists'), h('p', { class: 'muted' }, 'Contas Xtream Codes, links M3U e arquivos M3U. Tudo fica armazenado neste aparelho.')),
    h('button', { class: 'btn primary', 'data-autofocus': !S.playlists.length || undefined, onclick: addPlaylist }, icon('plus'), 'Adicionar')));
  if (!S.playlists.length) {
    add(root, h('div', { class: 'empty small' }, h('p', { class: 'muted' }, 'Nenhuma playlist cadastrada.')));
  }
  const list = h('div', { class: 'pl-list' });
  for (const pl of S.playlists) {
    const active = S.pl?.id === pl.id;
    const acc = pl.account;
    const busy = isRunning('playlist', pl.id) || isRunning('epg', pl.id);
    const lines = [
      pl.type === 'xtream' ? `Xtream · ${pl.server}` : pl.fileName ? `Arquivo · ${pl.fileName}` : `M3U · ${pl.url}`,
      pl.counts ? `${pl.counts.live} canais · ${pl.counts.movie} filmes · ${pl.counts.series} séries · atualizada ${ago(pl.lastSync)}` : 'Ainda não carregada',
      pl.epgSync ? `Guia: ${pl.epgCount || 0} canais · ${ago(pl.epgSync)}` : (pl.epgUrl || pl.type === 'xtream' ? 'Guia: não carregado' : 'Guia: sem endereço'),
      acc ? [`Conta: ${acc.status || '—'}`, acc.exp ? `expira em ${fmtDate(acc.exp)}` : 'sem data de expiração', acc.maxConn ? `${acc.activeConn}/${acc.maxConn} conexões` : null, acc.trial ? 'teste' : null].filter(Boolean).join(' · ') : null,
    ].filter(Boolean);
    list.append(h('div', { class: `pl-card${active ? ' active' : ''}` },
      h('div', { class: 'pl-info' },
        h('h2', null, pl.name, active ? h('span', { class: 'tag' }, 'Em uso') : null, busy ? h('span', { class: 'tag warn' }, 'Atualizando') : null),
        lines.map((l) => h('div', { class: 'muted small mono-ish' }, l)),
        pl.error ? h('div', { class: 'err small' }, `Último erro: ${pl.error}`) : null),
      h('div', { class: 'pl-actions', 'data-group': `pl-${pl.id}` },
        !active ? h('button', { class: 'btn primary sm', onclick: async () => {
          if (!pl.counts) { await syncAndReload(pl.id); }
          await activate(pl.id); toast(`Usando ${pl.name}`); location.hash = '#/home';
        } }, 'Usar') : null,
        h('button', { class: 'btn sm', onclick: async () => { rerender(); await syncAndReload(pl.id, { epg: false }); rerender(); } }, icon('refresh'), 'Atualizar lista'),
        h('button', { class: 'btn sm', disabled: !pl.epgUrl && pl.type !== 'xtream', onclick: async () => { rerender(); await syncEpg(pl.id); rerender(); } }, 'Atualizar guia'),
        h('button', { class: 'btn sm', onclick: async () => {
          const before = JSON.stringify([pl.type, pl.server, pl.username, pl.password, pl.url, pl.fileName]);
          const r = await playlistForm(pl);
          if (!r) return;
          await loadPlaylists();
          const after = JSON.stringify([r.type, r.server, r.username, r.password, r.url, r.fileName]);
          if (before !== after || r.fileText !== pl.fileText) await syncAndReload(r.id);
          else if (r.epgUrl !== pl.epgUrl) await syncEpg(r.id);
          if (S.pl?.id === r.id) S.pl = S.playlists.find((p) => p.id === r.id);
          rerender();
        } }, icon('edit'), 'Editar'),
        h('button', { class: 'btn sm danger', onclick: async () => {
          if (!await confirmDialog('Excluir playlist?', `“${pl.name}” será removida deste aparelho, junto com favoritos, histórico e guia.`, 'Excluir', true)) return;
          await db.deletePlaylist(pl.id);
          await loadPlaylists();
          if (active) await activate(S.playlists[0]?.id || null);
          toast('Playlist excluída');
          rerender();
        } }, icon('trash'), 'Excluir'))));
  }
  add(root, list);
  if (args[0] === 'add') { history.replaceState(null, '', '#/playlists'); setTimeout(addPlaylist, 50); }
}

export async function viewSettings(root) {
  const st = S.settings;
  const section = (title, ...rows) => h('section', { class: 'set-sec' }, h('h2', null, title), ...rows);
  const row = (label, hint, control) => h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'set-label' }, label), hint ? h('div', { class: 'muted small' }, hint) : null), control);
  const setCue = async (k, v) => { await setSetting(k, v); applyCueStyle(); };
  const proxyStatus =h('span', null, S.proxyAvailable ? 'Servidor local detectado.' : 'Servidor local não detectado: sem proxy, a origem precisa permitir CORS e o app precisa estar em http.');
  const ua = h('input', { class: 'input', value: st.ua || '', placeholder: 'Padrão: Sintonia/1.0', 'aria-label': 'User-Agent' });
  ua.addEventListener('change', async () => { await setSetting('ua', ua.value.trim()); toast('User-Agent salvo'); });
  const importInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'sintonia') throw new Error('Arquivo não é um backup do Sintonia');
      if (!await confirmDialog('Importar backup?', `${data.playlists.length} playlists, ${data.favorites.length} favoritos. Itens com o mesmo identificador serão substituídos.`, 'Importar')) return;
      await db.putMany('playlists', data.playlists);
      await db.putMany('favorites', data.favorites || []);
      await db.putMany('history', data.history || []);
      await db.putMany('settings', data.settings || []);
      toast('Backup importado. Atualizando as playlists…');
      await loadPlaylists();
      for (const p of data.playlists) await syncAndReload(p.id, { quiet: true });
      location.reload();
    } catch (e) { toast(`Falha ao importar: ${e.message}`, 6000); }
  });

  add(root, 
    h('header', { class: 'page-head' }, h('h1', null, 'Ajustes')),
    section('Rede',
      row('Proxy do servidor local', proxyStatus, segmented([
        { value: 'auto', label: 'Automático' }, { value: 'on', label: 'Sempre' }, { value: 'off', label: 'Desligado' },
      ], st.proxyMode, async (v) => { await setSetting('proxyMode', v); toast(S.net.proxy ? 'Proxy ativo' : 'Proxy desligado'); })),
      row('User-Agent', 'Alguns provedores exigem um identificador específico. Só é aplicado pelo proxy.', ua),
      row('Verificar servidor local', null, h('button', { class: 'btn sm', onclick: async () => { await detectProxy(); toast(S.proxyAvailable ? 'Servidor local encontrado' : 'Servidor local não encontrado'); rerender(); } }, 'Verificar'))),
    section('Reprodução',
      row('Formato ao vivo (Xtream)', 'HLS (.m3u8) ou MPEG-TS (.ts). Automático usa o que a conta permite, com preferência por HLS.', segmented([
        { value: 'auto', label: 'Automático' }, { value: 'hls', label: 'HLS' }, { value: 'ts', label: 'MPEG-TS' },
      ], st.liveFormat, (v) => setSetting('liveFormat', v))),
      row('Proporção da imagem', null, segmented([
        { value: 'contain', label: 'Ajustar' }, { value: 'cover', label: 'Preencher' }, { value: 'fill', label: 'Esticar' },
      ], st.aspect, (v) => { setSetting('aspect', v); document.querySelector('#player video, .stage video')?.style.setProperty('object-fit', v); }))),
    section('Legendas e áudio',
      row('Tamanho da legenda', null, segmented([
        { value: 's', label: 'P' }, { value: 'm', label: 'M' }, { value: 'l', label: 'G' }, { value: 'xl', label: 'GG' },
      ], st.subSize, (v) => setCue('subSize', v))),
      row('Cor da legenda', null, segmented([
        { value: 'white', label: 'Branca' }, { value: 'yellow', label: 'Amarela' },
      ], st.subColor, (v) => setCue('subColor', v))),
      row('Fundo da legenda', null, segmented([
        { value: 'none', label: 'Nenhum' }, { value: 'semi', label: 'Translúcido' }, { value: 'solid', label: 'Sólido' },
      ], st.subBg, (v) => setCue('subBg', v))),
      row('Posição da legenda externa', 'Mais alta evita que a barra do player cubra o texto.', segmented([
        { value: 'bottom', label: 'Embaixo' }, { value: 'raised', label: 'Mais alta' }, { value: 'top', label: 'Topo' },
      ], st.subPos, (v) => setCue('subPos', v))),
      row('Idioma preferido da legenda', 'Ativada sozinha quando o stream traz uma legenda nesse idioma.', segmented([
        { value: '', label: 'Nenhum' }, ...LANGS.slice(0, 4).map((l) => ({ value: l.code, label: l.name })),
      ], st.subLang, (v) => setSetting('subLang', v))),
      row('Idioma preferido do áudio', 'Escolhido sozinho quando o stream traz várias faixas de áudio.', segmented([
        { value: '', label: 'Padrão' }, ...LANGS.slice(0, 4).map((l) => ({ value: l.code, label: l.name })),
      ], st.audioLang, (v) => setSetting('audioLang', v)))),
    section('Atualização automática',
      row('Lista de canais', 'Ao abrir o app, se a última atualização for mais antiga que o intervalo.', segmented([
        { value: 0, label: 'Desligada' }, { value: 12, label: '12 h' }, { value: 24, label: '24 h' }, { value: 72, label: '3 dias' },
      ], st.autoUpdateHours, (v) => setSetting('autoUpdateHours', v))),
      row('Guia (EPG)', null, segmented([
        { value: 0, label: 'Desligada' }, { value: 6, label: '6 h' }, { value: 12, label: '12 h' }, { value: 24, label: '24 h' },
      ], st.epgUpdateHours, (v) => setSetting('epgUpdateHours', v)))),
    section('Dados',
      row('Backup', 'Exporta playlists (com credenciais), favoritos, histórico e ajustes em JSON. Guarde em local seguro.', h('div', { class: 'row' },
        h('button', { class: 'btn sm', onclick: exportBackup }, 'Exportar'),
        h('button', { class: 'btn sm', onclick: () => importInput.click() }, 'Importar'), importInput)),
      row('Histórico', 'Remove o progresso de filmes e séries e os canais recentes.', h('button', { class: 'btn sm', onclick: async () => {
        if (!await confirmDialog('Limpar histórico?', null, 'Limpar', true)) return;
        await db.clearStore('history'); toast('Histórico apagado');
      } }, 'Limpar')),
      row('Apagar tudo', 'Remove todas as playlists, guias, favoritos, histórico e ajustes deste aparelho.', h('button', { class: 'btn sm danger', onclick: async () => {
        if (!await confirmDialog('Apagar todos os dados?', 'Esta ação não pode ser desfeita.', 'Apagar', true)) return;
        for (const s of db.STORES) await db.clearStore(s);
        location.hash = '#/home'; location.reload();
      } }, 'Apagar'))),
    section('Sobre',
      h('p', { class: 'muted small' }, 'Sintonia 1.0 · player de IPTV de código próprio, gratuito e sem ativação. Reproduz listas M3U e contas Xtream Codes informadas pelo usuário. Não inclui, vende nem indica canais ou conteúdo; o usuário é responsável por ter direito de acesso às fontes que cadastrar.'),
      h('p', { class: 'muted small' }, 'Bibliotecas: hls.js e mpegts.js (Apache-2.0).')),
  );
  computeNet();
  focusFirst(root);
}
