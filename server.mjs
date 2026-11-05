#!/usr/bin/env node
// Sintonia — servidor local: entrega o app e faz proxy de playlists, EPG e streams.
// Sem dependências externas. Requer Node.js 18 ou superior.
//
// Uso:  node server.mjs [--port 8080] [--host 127.0.0.1]
//       --host 0.0.0.0 permite abrir o app em outros aparelhos da rede (TV, celular).

import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const VERSION = '1.0.0';
const ROOT = resolve(fileURLToPath(new URL('./public/', import.meta.url)));

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i > -1 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env[name.toUpperCase()] || def;
}
const PORT = Number(arg('port', 8080));
const HOST = arg('host', '127.0.0.1');
const DEFAULT_UA = 'Sintonia/1.0';
const HEADER_TIMEOUT_MS = 25000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type, X-Final-Url',
};

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { rel = pathname; }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = resolve(join(ROOT, rel));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
  let st;
  try { st = statSync(file); } catch { st = null; }
  if (!st || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Não encontrado'); return; }
  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file).pipe(res);
}

function isSelf(target) {
  const local = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) local.add(i.address);
  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  return local.has(target.hostname) && port === PORT;
}

function proxify(abs, ua) {
  return `/proxy?u=${encodeURIComponent(abs)}${ua ? `&ua=${encodeURIComponent(ua)}` : ''}`;
}

// Reescreve uma playlist HLS para que segmentos, chaves e sub-playlists passem pelo proxy.
function rewriteHls(text, baseUrl, ua) {
  const abs = (u) => { try { return new URL(u, baseUrl).href; } catch { return u; } };
  return text.split(/\r?\n/).map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${proxify(abs(u), ua)}"`);
    }
    return proxify(abs(t), ua);
  }).join('\n');
}

async function handleProxy(req, res, url) {
  const raw = url.searchParams.get('u');
  const ua = url.searchParams.get('ua') || '';
  let target;
  try { target = new URL(raw); } catch { target = null; }
  if (!target || !/^https?:$/.test(target.protocol)) {
    res.writeHead(400, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' }).end('URL inválida');
    return;
  }
  if (isSelf(target)) {
    res.writeHead(400, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' }).end('O proxy não acessa o próprio servidor');
    return;
  }

  const headers = { 'User-Agent': ua || DEFAULT_UA, Accept: '*/*' };
  if (req.headers.range) headers.Range = req.headers.range;

  const ac = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ac.abort(); });
  const timer = setTimeout(() => ac.abort(), HEADER_TIMEOUT_MS);

  let up;
  try {
    up = await fetch(target, { headers, redirect: 'follow', signal: ac.signal, method: req.method === 'HEAD' ? 'HEAD' : 'GET' });
  } catch (e) {
    clearTimeout(timer);
    if (!res.headersSent && !res.destroyed) {
      res.writeHead(502, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' })
        .end(`Falha ao acessar a origem: ${e.cause?.code || e.name || 'erro'}`);
    }
    return;
  }
  clearTimeout(timer);

  const finalUrl = up.url || target.href;
  const ct = up.headers.get('content-type') || '';
  const encoded = !!up.headers.get('content-encoding');
  const out = { ...CORS, 'Cache-Control': 'no-store', 'X-Final-Url': finalUrl };
  if (ct) out['Content-Type'] = ct;
  for (const h of ['content-range', 'accept-ranges', 'last-modified', 'etag']) {
    const v = up.headers.get(h);
    if (v) out[h] = v;
  }

  const path = new URL(finalUrl).pathname.toLowerCase();
  const maybePlaylist = /mpegurl/i.test(ct) || path.endsWith('.m3u8') || path.endsWith('.m3u');
  const len = Number(up.headers.get('content-length') || 0);

  if (maybePlaylist && req.method !== 'HEAD' && (!len || len < 64 * 1024 * 1024)) {
    let text;
    try { text = await up.text(); } catch { res.writeHead(502, CORS).end(); return; }
    // Só reescreve playlists HLS (#EXT-X-). Listas de canais M3U seguem sem alteração.
    const body = Buffer.from(text.includes('#EXT-X-') ? rewriteHls(text, finalUrl, ua) : text, 'utf8');
    out['Content-Length'] = body.length;
    res.writeHead(up.status, out).end(body);
    return;
  }

  if (!encoded && up.headers.get('content-length')) out['Content-Length'] = up.headers.get('content-length');
  res.writeHead(up.status, out);
  if (!up.body || req.method === 'HEAD') { res.end(); return; }
  const stream = Readable.fromWeb(up.body);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://local'); } catch { res.writeHead(400).end(); return; }
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS).end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }

  if (url.pathname === '/api/health') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      .end(JSON.stringify({ ok: true, app: 'sintonia', version: VERSION, proxy: true }));
    return;
  }
  if (url.pathname === '/proxy') {
    try { await handleProxy(req, res, url); } catch { if (!res.headersSent) res.writeHead(500, CORS).end(); else res.destroy(); }
    return;
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  const urls = [];
  if (HOST === '0.0.0.0' || HOST === '::') {
    urls.push(`http://localhost:${PORT}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const i of list || []) if (i.family === 'IPv4' && !i.internal) urls.push(`http://${i.address}:${PORT}`);
    }
  } else urls.push(`http://${HOST}:${PORT}`);
  console.log(`Sintonia ${VERSION} em execução:`);
  for (const u of urls) console.log(`  ${u}`);
  if (HOST !== '0.0.0.0') console.log('Para abrir em outros aparelhos da rede: node server.mjs --host 0.0.0.0');
});
