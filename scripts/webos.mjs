#!/usr/bin/env node
// Empacota (.ipk) e instala o app na TV LG com a CLI do webOS (ares-*).
//
// Uso:  node scripts/webos.mjs package            gera dist/<id>_<versão>_all.ipk
//       node scripts/webos.mjs install            empacota e instala na TV
//       node scripts/webos.mjs run                instala e abre o app na TV
//       node scripts/webos.mjs inspect            abre o Web Inspector do app (com o app aberto na TV)
//
// Variáveis:
//   WEBOS_DEVICE   nome da TV cadastrada com ares-setup-device (padrão: tv)
//
// Requer a CLI do webOS: npm install -g @webos-tools/cli  (passo a passo: README, seção "LG (webOS)").
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlatform, WEBOS_ID } from './build.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIST = join(ROOT, 'dist');
const cmd = process.argv[2] || 'package';
const device = process.env.WEBOS_DEVICE || 'tv';
const win = process.platform === 'win32';
const COMMANDS = ['package', 'install', 'run', 'inspect'];

if (!COMMANDS.includes(cmd)) {
  console.error(`Comando desconhecido: ${cmd}. Use: ${COMMANDS.join(', ')}`);
  process.exit(2);
}

function ares(tool, args, { inherit = false } = {}) {
  console.log(`> ${tool} ${args.join(' ')}`);
  try {
    return execFileSync(tool, args, { stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'inherit'], encoding: 'utf8', shell: win });
  } catch (e) {
    if (e.code === 'ENOENT' || /not recognized|not found/i.test(String(e.stderr || e.message))) {
      console.error('CLI do webOS não encontrada. Instale com: npm install -g @webos-tools/cli');
      process.exit(2);
    }
    process.exit(e.status || 1);
  }
}

// Confere a CLI antes do build (mensagem clara em vez de um erro do sistema).
try { execFileSync('ares-package', ['--version'], { stdio: 'ignore', shell: win }); } catch {
  console.error('CLI do webOS não encontrada. Instale com: npm install -g @webos-tools/cli');
  console.error('Passo a passo: README, seção "LG (webOS)".');
  process.exit(2);
}

if (cmd === 'inspect') {
  ares('ares-inspect', ['-d', device, '--app', WEBOS_ID, '--open'], { inherit: true });
  process.exit(0);
}

const src = await buildPlatform('webos');
const { version } = JSON.parse(readFileSync(join(src, 'appinfo.json'), 'utf8'));
// --no-minify: o build já minifica (e converte para Chromium 56); a CLI não deve mexer no código.
process.stdout.write(ares('ares-package', ['--no-minify', '-o', DIST, src]));
const ipk = join(DIST, `${WEBOS_ID}_${version}_all.ipk`);
if (!existsSync(ipk)) { console.error(`O pacote não foi gerado: ${ipk}`); process.exit(1); }
console.log(`Pacote: ${ipk}`);
if (cmd === 'package') {
  // Loja LG: um pacote por resolução gráfica. O de 1920x1080 só é publicado nas TVs UHD; o de
  // 1280x720 cobre as TVs Full HD. O layout do app é responsivo: só muda o valor declarado.
  const fhd = join(DIST, 'fhd-1280x720');
  rmSync(fhd, { recursive: true, force: true });
  cpSync(src, fhd, { recursive: true });
  const info = JSON.parse(readFileSync(join(fhd, 'appinfo.json'), 'utf8'));
  writeFileSync(join(fhd, 'appinfo.json'), JSON.stringify({ ...info, resolution: '1280x720' }, null, 2));
  const outFhd = join(DIST, 'ipk-1280x720');
  mkdirSync(outFhd, { recursive: true });
  process.stdout.write(ares('ares-package', ['--no-minify', '-o', outFhd, fhd]));
  console.log(`Pacote Full HD: ${join(outFhd, `${WEBOS_ID}_${version}_all.ipk`)}`);
  process.exit(0);
}

process.stdout.write(ares('ares-install', ['-d', device, ipk]));
if (cmd === 'run') process.stdout.write(ares('ares-launch', ['-d', device, WEBOS_ID]));
