// Testes do servidor e das regras de segurança do proxy (Node 18+).
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPrivateIp, rejectReason, localHostNames } from '../lib/netguard.mjs';
import { createHandler, rewriteHls } from '../lib/app.mjs';

// ---- isPrivateIp ----
for (const ip of ['127.0.0.1', '127.8.8.8', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.10', '169.254.169.254',
  '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd00::1', 'fc12::3', 'ff02::1',
  '::ffff:127.0.0.1', '::ffff:7f00:1', '[::1]', '::ffff:c0a8:1', 'não-é-ip']) {
  assert.equal(isPrivateIp(ip), true, `deveria bloquear ${ip}`);
}
for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.0.1', '192.169.0.1', '2001:4860:4860::8888', '::ffff:8.8.8.8']) {
  assert.equal(isPrivateIp(ip), false, `deveria permitir ${ip}`);
}

// ---- rejectReason ----
const hosts = localHostNames();
assert.equal(rejectReason({ host: '127.0.0.1:8080' }, hosts), null);
assert.equal(rejectReason({ host: 'localhost:8080', 'sec-fetch-site': 'same-origin' }, hosts), null);
assert.equal(rejectReason({ host: 'localhost:8080', origin: 'http://localhost:8080' }, hosts), null);
assert.equal(rejectReason({ host: 'app.localhost:8080' }, hosts), null);
assert.ok(rejectReason({ host: 'atacante.example:8080' }, hosts), 'Host desconhecido (DNS rebinding)');
assert.ok(rejectReason({ host: '127.0.0.1:8080', 'sec-fetch-site': 'cross-site' }, hosts));
assert.ok(rejectReason({ host: '127.0.0.1:8080', 'sec-fetch-site': 'same-site' }, hosts));
assert.ok(rejectReason({ host: '127.0.0.1:8080', origin: 'https://site.example' }, hosts));
assert.ok(rejectReason({ host: '127.0.0.1:8080', origin: 'null' }, hosts));
assert.ok(rejectReason({}, hosts));

// ---- rewriteHls ----
const pl = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k.key"\n#EXTINF:2,\nseg0.ts\n';
const rw = rewriteHls(pl, 'http://cdn.example/a/index.m3u8', 'UA');
assert.ok(rw.includes(`URI="/proxy?u=${encodeURIComponent('http://cdn.example/a/k.key')}&ua=UA"`));
assert.ok(rw.includes(`/proxy?u=${encodeURIComponent('http://cdn.example/a/seg0.ts')}&ua=UA`));

// ---- Integração ----
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const origin = http.createServer((req, res) => {
  if (req.url === '/ok') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
  if (req.url === '/echo-ref') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end(req.headers.referer || '-');
  if (req.url === '/redir') return res.writeHead(302, { Location: `http://127.0.0.2:${oport}/ok` }).end();
  if (req.url === '/redir-ok') return res.writeHead(301, { Location: '/ok' }).end();
  if (req.url === '/live.m3u8') {
    return res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Encoding': 'gzip' })
      .end(zlib.gzipSync('#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nseg0.ts\n'));
  }
  if (req.url === '/api.json') {
    return res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }).end(zlib.gzipSync('{"a":1}'));
  }
  res.writeHead(404).end();
});
const oport = await listen(origin);

async function proxyServer(opts) {
  let handler;
  const srv = http.createServer((q, s) => handler(q, s));
  const port = await listen(srv);
  handler = createHandler({ root: resolve(fileURLToPath(new URL('../public/', import.meta.url))), port, ...opts });
  return { srv, port };
}
function get(port, path, headers = {}) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port, path, headers }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
    }).on('error', rej);
  });
}
const P = (u) => `/proxy?u=${encodeURIComponent(u)}`;

// Padrão: endereços locais bloqueados.
const strict = await proxyServer({});
for (const u of [`http://127.0.0.1:${oport}/ok`, `http://localhost:${oport}/ok`, `http://[::ffff:127.0.0.1]:${oport}/ok`, 'http://10.0.0.1/x', 'http://169.254.169.254/latest/meta-data']) {
  const r = await get(strict.port, P(u));
  assert.equal(r.status, 403, `deveria bloquear ${u}`);
}
assert.equal((await get(strict.port, P('file:///etc/passwd'))).status, 400);
assert.equal((await get(strict.port, '/api/health')).status, 200);
assert.equal((await get(strict.port, '/index.html')).status, 200);

// Apenas 127.0.0.2 bloqueado: testa redirecionamentos e o conteúdo repassado.
const lax = await proxyServer({ blocked: (ip) => ip === '127.0.0.2' });
let r = await get(lax.port, P(`http://127.0.0.1:${oport}/ok`));
assert.equal(r.status, 200);
assert.equal(r.body.toString(), 'ok');
assert.equal(r.headers['access-control-allow-origin'], undefined, 'sem CORS aberto');
r = await get(lax.port, P(`http://127.0.0.1:${oport}/redir-ok`));
assert.equal(r.status, 200);
assert.equal(r.headers['x-final-url'], `http://127.0.0.1:${oport}/ok`);
r = await get(lax.port, P(`http://127.0.0.1:${oport}/redir`));
assert.equal(r.status, 403, 'redirecionamento para destino bloqueado');
r = await get(lax.port, P(`http://127.0.0.1:${oport}/live.m3u8`));
assert.equal(r.status, 200);
assert.equal(r.headers['content-encoding'], undefined);
assert.ok(r.body.toString().includes(`/proxy?u=${encodeURIComponent(`http://127.0.0.1:${oport}/seg0.ts`)}`), 'HLS gzip descompactado e reescrito');
r = await get(lax.port, P(`http://127.0.0.1:${oport}/api.json`));
assert.equal(r.headers['content-encoding'], 'gzip');
assert.equal(zlib.gunzipSync(r.body).toString(), '{"a":1}');
r = await get(lax.port, P(`http://127.0.0.1:${lax.port}/api/health`));
assert.equal(r.status, 403, 'o proxy não acessa o próprio servidor');
r = await get(lax.port, P(`http://127.0.0.1:${oport}/ok`), { 'Sec-Fetch-Site': 'cross-site' });
assert.equal(r.status, 403, 'requisição vinda de outro site');
r = await get(lax.port, P(`http://127.0.0.1:${oport}/ok`), { Host: `atacante.example:${lax.port}` });
assert.equal(r.status, 403, 'Host estranho (DNS rebinding)');

// Referer do canal: repassado à origem e às URLs reescritas da playlist HLS.
r = await get(lax.port, `${P(`http://127.0.0.1:${oport}/echo-ref`)}&ref=${encodeURIComponent('https://site.example/')}`);
assert.equal(r.body.toString(), 'https://site.example/');
r = await get(lax.port, `${P(`http://127.0.0.1:${oport}/echo-ref`)}&ref=${encodeURIComponent('javascript:alert(1)')}`);
assert.equal(r.body.toString(), '-', 'Referer inválido é descartado');
assert.ok(rewriteHls('#EXTM3U\n#EXTINF:2,\nseg.ts\n', 'http://c.example/', 'UA', 'https://r.example/').includes('&ref=https%3A%2F%2Fr.example%2F'));

// --allow-private libera tudo.
const open = await proxyServer({ allowPrivate: true });
assert.equal((await get(open.port, P(`http://localhost:${oport}/ok`))).status, 200);

for (const s of [origin, strict.srv, lax.srv, open.srv]) s.close();
console.log('testes do proxy: ok');
