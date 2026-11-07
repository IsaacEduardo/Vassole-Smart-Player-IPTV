#!/usr/bin/env node
// Vassole Smart Player IPTV — servidor local: entrega o app e faz proxy de playlists, EPG e streams.
// Sem dependências externas. Requer Node.js 18 ou superior.
//
// Uso:  node server.mjs [--port 8080] [--host 127.0.0.1] [--allow-private] [--allow-host nome]
//       --host 0.0.0.0     permite abrir o app em outros aparelhos da rede (TV, celular).
//       --allow-private    permite que o proxy acesse endereços locais e da rede privada
//                          (necessário para provedores na própria rede e para o provedor de teste).
//       --allow-host nome  aceita acessar o app por outro nome (ex.: um domínio local próprio).

import http from 'node:http';
import os from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler, VERSION } from './lib/app.mjs';

const ROOT = resolve(fileURLToPath(new URL('./public/', import.meta.url)));

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return process.env[name.toUpperCase().replace(/-/g, '_')] || def;
}
function flag(name) {
  const env = process.env[name.toUpperCase().replace(/-/g, '_')];
  return process.argv.includes(`--${name}`) || env === '1' || env === 'true';
}

const PORT = Number(arg('port', 8080));
const HOST = arg('host', '127.0.0.1');
const ALLOW_PRIVATE = flag('allow-private');
const EXTRA_HOSTS = [HOST, ...String(arg('allow-host', '')).split(',').map((s) => s.trim())].filter(Boolean);

const server = http.createServer(createHandler({ root: ROOT, port: PORT, allowPrivate: ALLOW_PRIVATE, extraHosts: EXTRA_HOSTS }));

server.listen(PORT, HOST, () => {
  const urls = [];
  if (HOST === '0.0.0.0' || HOST === '::') {
    urls.push(`http://localhost:${PORT}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const i of list || []) if (i.family === 'IPv4' && !i.internal) urls.push(`http://${i.address}:${PORT}`);
    }
  } else urls.push(`http://${HOST}:${PORT}`);
  console.log(`Vassole Smart Player IPTV ${VERSION} em execução:`);
  for (const u of urls) console.log(`  ${u}`);
  if (ALLOW_PRIVATE) console.log('Proxy com acesso a endereços locais e privados (--allow-private).');
  if (HOST !== '0.0.0.0') console.log('Para abrir em outros aparelhos da rede: node server.mjs --host 0.0.0.0');
});
