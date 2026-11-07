// Execução das sincronizações no worker, com indicador de progresso.
import { S } from './store.js';
import { caps, BUNDLED } from './platform.js';

let worker = null;
let workerOk = null;
let seq = 0;
const pending = new Map();
const running = new Map();

function onMsg(ev) {
  const m = ev.data;
  const p = pending.get(m.id);
  if (!p) return;
  if (m.type === 'progress') p.onProgress?.(m.text);
  else {
    pending.delete(m.id);
    if (m.type === 'done') p.res(m.result); else p.rej(new Error(m.message));
  }
}

function ensureWorker() {
  if (workerOk !== null) return Promise.resolve(workerOk);
  if (!caps.syncWorker) { workerOk = false; return Promise.resolve(false); }
  return new Promise((resolve) => {
    let t;
    try {
      // No pacote (build) o worker é um script clássico; servido pelo server.mjs, é um módulo.
      worker = BUNDLED ? new Worker('js/sync-worker.js') : new Worker('js/sync-worker.js', { type: 'module' });
      t = setTimeout(() => { workerOk = false; resolve(false); }, 5000);
      worker.onmessage = (ev) => {
        if (ev.data.type === 'ready') { clearTimeout(t); workerOk = true; worker.onmessage = onMsg; resolve(true); }
      };
      worker.onerror = () => { clearTimeout(t); workerOk = false; resolve(false); };
    } catch { workerOk = false; resolve(false); }
  });
}

function setBanner() {
  const el = document.getElementById('task');
  const list = [...running.values()];
  if (!list.length) { el.hidden = true; return; }
  el.hidden = false;
  el.querySelector('.task-text').textContent = list[list.length - 1].text;
}

// cmd: 'playlist' | 'epg'
export function runTask(cmd, pid, label, onProgress) {
  const k = `${cmd}|${pid}`;
  if (running.has(k)) return running.get(k).promise;
  const entry = { text: label };
  const progress = (text) => { entry.text = `${label}: ${text}`; setBanner(); onProgress?.(text); };
  running.set(k, entry);
  entry.promise = (async () => {
    setBanner();
    try {
      if (await ensureWorker()) {
        return await new Promise((res, rej) => {
          const id = ++seq;
          pending.set(id, { res, rej, onProgress: progress });
          worker.postMessage({ id, cmd, pid, net: S.net, opts: syncOpts() });
        });
      }
      const m = await import('./sync.js');
      return await (cmd === 'epg' ? m.syncEpg : m.syncPlaylist)(pid, S.net, progress, syncOpts());
    } finally {
      running.delete(k);
      setBanner();
    }
  })();
  return entry.promise;
}

function syncOpts() { return { langs: [...(S.settings.langPrefs || [])] }; }

export const isRunning = (cmd, pid) => running.has(`${cmd}|${pid}`);
