// Regras de segurança do proxy: quem pode usá-lo e quais destinos ele pode acessar.
import dns from 'node:dns';
import net from 'node:net';
import os from 'node:os';

function v4Parts(ip) {
  const p = ip.split('.').map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null;
}

function isPrivateV4(ip) {
  const p = v4Parts(ip);
  if (!p) return true; // formato inesperado: trata como bloqueado
  const [a, b] = p;
  return a === 0 // "esta rede"
    || a === 10
    || a === 127 // loopback
    || (a === 100 && b >= 64 && b <= 127) // CGNAT
    || (a === 169 && b === 254) // link-local
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && p[2] === 0) // IETF
    || (a === 198 && (b === 18 || b === 19)) // testes de rede
    || a >= 224; // multicast e reservados
}

// "fe80::1" -> [0xfe80, 0, 0, 0, 0, 0, 0, 1]
function expandV6(s) {
  const [head, tail] = s.includes('::') ? s.split('::') : [s, null];
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const zeros = tail === null ? [] : Array(8 - a.length - b.length).fill('0');
  return [...a, ...zeros, ...b].map((x) => parseInt(x || '0', 16));
}

// Endereços que não devem ser acessados pelo proxy: loopback, redes privadas, link-local etc.
export function isPrivateIp(ip) {
  let s = String(ip || '').trim().toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone > -1) s = s.slice(0, zone);
  const kind = net.isIP(s);
  if (kind === 4) return isPrivateV4(s);
  if (kind !== 6) return true;
  // IPv4 embutido (::ffff:1.2.3.4, ::1.2.3.4, 64:ff9b::1.2.3.4): vale a regra do IPv4.
  if (s.includes('.')) return isPrivateV4(s.slice(s.lastIndexOf(':') + 1));
  const g = expandV6(s);
  if (g.slice(0, 7).every((x) => x === 0) && g[7] <= 1) return true; // :: e ::1
  // IPv4 mapeado (a API URL escreve ::ffff:127.0.0.1 como ::ffff:7f00:1).
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return isPrivateV4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  }
  const first = g[0];
  return (first & 0xfe00) === 0xfc00 // fc00::/7 (ULA)
    || (first & 0xffc0) === 0xfe80 // fe80::/10 (link-local)
    || (first & 0xff00) === 0xff00; // multicast
}

export class BlockedError extends Error {
  constructor(addr) {
    super(`Destino bloqueado (endereço local ou privado: ${addr}). Para permitir, inicie o servidor com --allow-private.`);
    this.code = 'EBLOCKED';
  }
}

// Destinos com IP literal não passam pelo DNS; são verificados aqui antes da conexão.
export function checkLiteral(hostname, blocked) {
  const h = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(h) && blocked(h)) throw new BlockedError(h);
}

// Função `lookup` para http.request: resolve o nome e recusa se algum endereço for bloqueado.
// Como o socket conecta no endereço validado aqui, uma troca de DNS entre a checagem e a conexão não escapa.
export function guardedLookup(blocked) {
  return (hostname, options, cb) => {
    if (typeof options === 'function') { cb = options; options = {}; }
    dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
      if (err) return cb(err);
      const bad = addrs.find((a) => blocked(a.address));
      if (bad) return cb(new BlockedError(bad.address));
      if (options.all) return cb(null, addrs);
      return cb(null, addrs[0].address, addrs[0].family);
    });
  };
}

// Nomes pelos quais o próprio servidor pode ser acessado. Um cabeçalho Host diferente indica
// DNS rebinding (um site cujo domínio passou a apontar para este computador).
export function localHostNames(extra = []) {
  const names = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  const hn = os.hostname().toLowerCase();
  names.add(hn); names.add(`${hn}.local`); names.add(`${hn}.lan`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) names.add(i.family === 'IPv6' || i.family === 6 ? `[${i.address.split('%')[0]}]` : i.address);
  }
  for (const e of extra) if (e) names.add(String(e).toLowerCase());
  return names;
}

function hostOnly(hostHeader) {
  const h = String(hostHeader || '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  const i = h.lastIndexOf(':');
  return i > -1 ? h.slice(0, i) : h;
}

// Decide se uma requisição ao proxy veio do próprio app. Devolve null (ok) ou o motivo da recusa.
export function rejectReason(headers, allowedHosts) {
  const host = hostOnly(headers.host);
  if (!host || !(allowedHosts.has(host) || host.endsWith('.localhost'))) return 'Host não reconhecido';
  const site = String(headers['sec-fetch-site'] || '').toLowerCase();
  if (site && site !== 'same-origin' && site !== 'none') return 'Requisição de outro site';
  const origin = headers.origin;
  if (origin) {
    if (origin === 'null') return 'Origem opaca (iframe isolado ou arquivo local)';
    let oh = '';
    try { oh = new URL(origin).host.toLowerCase(); } catch { return 'Origem inválida'; }
    if (oh !== String(headers.host || '').toLowerCase()) return 'Requisição de outra origem';
  }
  return null;
}
