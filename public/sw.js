// Service worker: guarda apenas os arquivos do app para abrir sem rede.
// Nunca armazena streams, playlists, guias ou respostas do proxy.
// <gerado por scripts/build-sw.mjs: não editar à mão>
const VERSION = 'sintonia-1.0.0-d4ce07af5c';
const SHELL = [
  './', 'fonts/ah-latin-400.woff2', 'fonts/ah-latin-700.woff2', 'fonts/ah-latin-ext-400.woff2',
  'fonts/ah-latin-ext-700.woff2', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon.svg',
  'icons/maskable-512.png', 'icons/maskable.svg', 'index.html', 'js/app.js', 'js/db.js', 'js/engine-android.js',
  'js/engine-native.js', 'js/engine-tizen.js', 'js/engine-web.js', 'js/lang.js', 'js/m3u.js', 'js/nav.js', 'js/net.js',
  'js/pin.js', 'js/platform.js', 'js/player-menus.js', 'js/player.js', 'js/polyfills.js', 'js/store.js',
  'js/subs-core.js', 'js/subs.js', 'js/sync-worker.js', 'js/sync.js', 'js/tasks.js', 'js/ui.js', 'js/util.js',
  'js/views-admin.js', 'js/views-cats.js', 'js/views-common.js', 'js/views-detail.js', 'js/views-guide.js',
  'js/views-home.js', 'js/views-live.js', 'js/views-search.js', 'js/views-vod.js', 'js/xmltv.js', 'js/xtream.js',
  'manifest.webmanifest', 'styles.css', 'vendor/hls.min.js', 'vendor/mpegts.js',
];
// </gerado>

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/proxy') || url.pathname.startsWith('/api/')) return;
  // Rede primeiro (o app atualiza ao recarregar); cache quando offline.
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
});
