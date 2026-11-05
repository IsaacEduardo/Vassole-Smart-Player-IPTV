#!/usr/bin/env node
// Gera a lista de arquivos (SHELL) e a versão do cache do service worker (public/sw.js).
// A versão leva um hash do conteúdo: qualquer mudança nos arquivos do app gera um cache novo.
//
// Uso:  node scripts/build-sw.mjs          atualiza public/sw.js
//       node scripts/build-sw.mjs --check  só verifica (sai com erro se estiver desatualizado)
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PUB = join(ROOT, 'public');
const SW = join(PUB, 'sw.js');
const EXT = new Set(['.html', '.css', '.js', '.webmanifest', '.woff2', '.svg', '.png']);
const TEXT = new Set(['.html', '.css', '.js', '.webmanifest', '.svg']);

function walk(dir) {
  return readdirSync(dir).sort().flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(PUB).filter((p) => p !== SW && EXT.has(extname(p).toLowerCase()) && statSync(p).size > 0);
const rel = (p) => relative(PUB, p).split(sep).join('/');
const hash = createHash('sha256');
for (const p of files) {
  hash.update(rel(p));
  // Fim de linha normalizado: o mesmo hash no Windows (CRLF) e no Linux (LF).
  const buf = readFileSync(p);
  hash.update(TEXT.has(extname(p).toLowerCase()) ? buf.toString('utf8').replace(/\r\n/g, '\n') : buf);
}
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = `sintonia-${pkg.version}-${hash.digest('hex').slice(0, 10)}`;

const list = ['./', ...files.map(rel)];
const lines = [];
let line = ' ';
for (const f of list.map((f) => `'${f}',`)) {
  if (line.length + f.length > 118) { lines.push(line); line = ' '; }
  line += ` ${f}`;
}
lines.push(line);
const block = `// <gerado por scripts/build-sw.mjs: não editar à mão>\nconst VERSION = '${version}';\nconst SHELL = [\n${lines.join('\n')}\n];\n// </gerado>`;

const src = readFileSync(SW, 'utf8').replace(/\r\n/g, '\n');
const re = /\/\/ <gerado[^\n]*>\n[\s\S]*?\/\/ <\/gerado>|const VERSION = [^\n]*\nconst SHELL = \[[\s\S]*?\];/;
if (!re.test(src)) { console.error('sw.js: bloco VERSION/SHELL não encontrado'); process.exit(2); }
const out = src.replace(re, block);

if (process.argv.includes('--check')) {
  if (out !== src) {
    console.error('public/sw.js está desatualizado. Rode: npm run build:sw');
    process.exit(1);
  }
  console.log(`service worker: ok (${version}, ${list.length} arquivos)`);
} else {
  if (out !== src) writeFileSync(SW, out);
  console.log(`service worker: ${version}, ${list.length} arquivos${out === src ? ' (sem mudanças)' : ''}`);
}
