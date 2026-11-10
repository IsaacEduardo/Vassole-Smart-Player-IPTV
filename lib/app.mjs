// Servidor do Vassole Smart Player IPTV: entrega os arquivos do app e faz proxy de playlists, guias e streams.
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { isPrivateIp, checkLiteral, guardedLookup, localHostNames, rejectReason, BlockedError } from './netguard.mjs';

// Versão única do projeto: a do package.json.
export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const DEFAULT_UA = 'VassoleSmartPlayer/1.0';
const HEADER_TIMEOUT_MS = 25000;
const MAX_REDIRECTS = 5;
const MAX_PLAYLIST_BYTES = 64 * 1024 * 1024;

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
  '.woff2': 'font/woff2',
};
const TEXT = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };

function serveStatic(root, req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { rel = pathname; }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = resolve(join(root, rel));
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  let st;
  try { st = statSync(file); } catch { st = null; }
  if (!st || !st.isFile()) { res.writeHead(404, TEXT).end('Não encontrado'); return; }
  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file).pipe(res);
}

function proxify(abs, ua, ref) {
  return `/proxy?u=${encodeURIComponent(abs)}${ua ? `&ua=${encodeURIComponent(ua)}` : ''}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`;
}

// Reescreve uma playlist HLS para que segmentos, chaves e sub-playlists passem pelo proxy.
// ua/ref: User-Agent e Referer do canal, repassados a segmentos, chaves e sub-playlists.
export function rewriteHls(text, baseUrl, ua, ref) {
  const abs = (u) => { try { return new URL(u, baseUrl).href; } catch { return u; } };
  return text.split(/\r?\n/).map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${proxify(abs(u), ua, ref)}"`);
    return proxify(abs(t), ua, ref);
  }).join('\n');
}

// Faz uma requisição à origem, seguindo redirecionamentos e validando cada destino.
function upstream(target, { method, headers, blocked, isSelf, signal }) {
  return new Promise((resolveP, rejectP) => {
    let hops = 0;
    const go = (url) => {
      if (!/^https?:$/.test(url.protocol)) { rejectP(new Error('Protocolo não permitido')); return; }
      try {
        checkLiteral(url.hostname, blocked);
        if (isSelf(url)) throw new BlockedError('o próprio servidor');
      } catch (e) { rejectP(e); return; }
      const mod = url.protocol === 'https:' ? https : http;
      const req = mod.request(url, { method, headers, lookup: guardedLookup(blocked), signal }, (res) => {
        const loc = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && loc && res.statusCode !== 304) {
          res.resume();
          if (++hops > MAX_REDIRECTS) { rejectP(new Error('Redirecionamentos demais')); return; }
          let next;
          try { next = new URL(loc, url); } catch { rejectP(new Error('Redirecionamento inválido')); return; }
          go(next);
          return;
        }
        resolveP({ res, finalUrl: url.href });
      });
      req.on('error', rejectP);
      req.end();
    };
    go(target);
  });
}

function decoded(res) {
  const enc = String(res.headers['content-encoding'] || '').toLowerCase();
  if (enc === 'gzip' || enc === 'x-gzip') return res.pipe(zlib.createGunzip());
  if (enc === 'deflate') return res.pipe(zlib.createInflate());
  if (enc === 'br') return res.pipe(zlib.createBrotliDecompress());
  return res;
}

async function readText(stream, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of stream) {
    size += c.length;
    if (size > limit) throw new Error('Playlist grande demais');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function handleProxy(req, res, url, opts) {
  const why = rejectReason(req.headers, opts.allowedHosts);
  if (why) { res.writeHead(403, TEXT).end(`Proxy recusado: ${why}`); return; }

  const raw = url.searchParams.get('u');
  const ua = (url.searchParams.get('ua') || '').slice(0, 512);
  // Referer do canal (#EXTVLCOPT:http-referrer): só um endereço http(s) válido.
  let ref = url.searchParams.get('ref') || '';
  try { ref = ref && /^https?:$/.test(new URL(ref).protocol) ? ref.slice(0, 2048) : ''; } catch { ref = ''; }
  let target;
  try { target = new URL(raw); } catch { target = null; }
  if (!target || !/^https?:$/.test(target.protocol)) { res.writeHead(400, TEXT).end('URL inválida'); return; }

  const headers = { 'User-Agent': ua || DEFAULT_UA, Accept: '*/*', 'Accept-Encoding': 'gzip, deflate' };
  if (ref) headers.Referer = ref;
  if (req.headers.range) headers.Range = req.headers.range;

  const ac = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ac.abort(); });
  const timer = setTimeout(() => ac.abort(), HEADER_TIMEOUT_MS);

  let up;
  try {
    up = await upstream(target, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers, blocked: opts.blocked, isSelf: opts.isSelf, signal: ac.signal });
  } catch (e) {
    clearTimeout(timer);
    if (res.headersSent || res.destroyed) return;
    if (e instanceof BlockedError) { res.writeHead(403, TEXT).end(e.message); return; }
    res.writeHead(502, TEXT).end(`Falha ao acessar a origem: ${e.code || e.name || 'erro'}`);
    return;
  }
  clearTimeout(timer);

  const { res: ures, finalUrl } = up;
  const ct = ures.headers['content-type'] || '';
  const out = { 'Cache-Control': 'no-store', 'X-Final-Url': finalUrl, 'X-Content-Type-Options': 'nosniff' };
  if (ct) out['Content-Type'] = ct;
  for (const h of ['content-range', 'accept-ranges', 'last-modified', 'etag']) {
    if (ures.headers[h]) out[h] = ures.headers[h];
  }

  const path = new URL(finalUrl).pathname.toLowerCase();
  const maybePlaylist = /mpegurl/i.test(ct) || path.endsWith('.m3u8') || path.endsWith('.m3u');
  const len = Number(ures.headers['content-length'] || 0);

  if (maybePlaylist && req.method !== 'HEAD' && (!len || len < MAX_PLAYLIST_BYTES)) {
    let text;
    try { text = await readText(decoded(ures), MAX_PLAYLIST_BYTES); } catch { if (!res.headersSent) res.writeHead(502, TEXT).end(); return; }
    // Só reescreve playlists HLS (#EXT-X-). Listas de canais M3U seguem sem alteração.
    const body = Buffer.from(text.includes('#EXT-X-') ? rewriteHls(text, finalUrl, ua, ref) : text, 'utf8');
    out['Content-Length'] = body.length;
    res.writeHead(ures.statusCode, out).end(body);
    return;
  }

  // Demais conteúdos seguem como vieram; o navegador descompacta se houver Content-Encoding.
  if (ures.headers['content-encoding']) out['Content-Encoding'] = ures.headers['content-encoding'];
  if (ures.headers['content-length']) out['Content-Length'] = ures.headers['content-length'];
  res.writeHead(ures.statusCode, out);
  if (req.method === 'HEAD') { ures.resume(); res.end(); return; }
  ures.on('error', () => res.destroy());
  ures.pipe(res);
}

// opts: { root, port, allowPrivate, extraHosts, blocked }
export function createHandler(opts) {
  const port = Number(opts.port);
  const blocked = opts.blocked || (opts.allowPrivate ? () => false : isPrivateIp);
  const selfNames = localHostNames();
  selfNames.add('0.0.0.0');
  const isSelf = (u) => {
    const p = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    return p === port && (selfNames.has(u.hostname.toLowerCase()) || u.hostname.endsWith('.localhost'));
  };
  const ctx = { allowedHosts: localHostNames(opts.extraHosts || []), blocked, isSelf };
  return async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://local'); } catch { res.writeHead(400).end(); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify({ ok: true, app: 'sintonia', version: VERSION, proxy: true }));
      return;
    }
    if (url.pathname === '/proxy') {
      try { await handleProxy(req, res, url, ctx); } catch { if (!res.headersSent) res.writeHead(500, TEXT).end(); else res.destroy(); }
      return;
    }
    serveStatic(opts.root, req, res, url.pathname);
  };
}
