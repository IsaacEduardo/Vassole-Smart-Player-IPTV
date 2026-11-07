import './polyfills.js';
import { syncPlaylist, syncEpg } from './sync.js';

self.onmessage = async (ev) => {
  const { id, cmd, pid, net, opts } = ev.data;
  const progress = (text) => self.postMessage({ id, type: 'progress', text });
  try {
    const fn = cmd === 'epg' ? syncEpg : syncPlaylist;
    const result = await fn(pid, net, progress, opts);
    self.postMessage({ id, type: 'done', result });
  } catch (e) {
    self.postMessage({ id, type: 'error', message: e.message || String(e) });
  }
};
self.postMessage({ type: 'ready' });
