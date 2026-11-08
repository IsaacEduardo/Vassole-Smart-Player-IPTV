#!/usr/bin/env node
// Empacota (.wgt) e instala o app na TV Samsung com a CLI do Tizen Studio.
//
// Uso:  node scripts/tizen.mjs package            gera dist/VassoleSmartPlayer.wgt (assinado)
//       node scripts/tizen.mjs install            empacota, conecta na TV e instala
//       node scripts/tizen.mjs run                instala e abre o app na TV
//
// Variáveis:
//   TIZEN_STUDIO   pasta do Tizen Studio (padrão: C:\tizen-studio ou ~/tizen-studio)
//   TIZEN_PROFILE  nome do perfil de certificado criado no Certificate Manager (obrigatório)
//   TIZEN_TV       IP da TV em Modo Desenvolvedor (para install/run)
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlatform, TIZEN_PACKAGE } from './build.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIST = join(ROOT, 'dist');
const APP_ID = `${TIZEN_PACKAGE}.SmartPlayer`;
const cmd = process.argv[2] || 'package';
const win = process.platform === 'win32';

function studio() {
  const cands = [process.env.TIZEN_STUDIO, win ? 'C:\\tizen-studio' : null, join(homedir(), 'tizen-studio')].filter(Boolean);
  const dir = cands.find((d) => existsSync(join(d, 'tools', 'ide', 'bin')));
  if (!dir) {
    console.error('Tizen Studio não encontrado. Instale-o (com "TV Extensions") e, se não estiver em C:\\tizen-studio,');
    console.error('defina TIZEN_STUDIO com a pasta de instalação. Passo a passo: README, seção "Samsung (Tizen)".');
    process.exit(2);
  }
  return {
    tizen: join(dir, 'tools', 'ide', 'bin', win ? 'tizen.bat' : 'tizen'),
    sdb: join(dir, 'tools', win ? 'sdb.exe' : 'sdb'),
  };
}

function run(bin, args) {
  console.log(`> ${bin.split(/[\\/]/).pop()} ${args.join(' ')}`);
  return execFileSync(bin, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', shell: win && bin.endsWith('.bat') });
}

const profile = process.env.TIZEN_PROFILE;
if (!profile) {
  console.error('Defina TIZEN_PROFILE com o nome do perfil de certificado (Tizen Studio › Tools › Certificate Manager).');
  process.exit(2);
}
const { tizen, sdb } = studio();

const src = await buildPlatform('tizen');
const out = run(tizen, ['package', '-t', 'wgt', '-s', profile, '-o', DIST, '--', src]);
process.stdout.write(out);
const wgt = readdirSync(DIST).filter((f) => f.endsWith('.wgt')).map((f) => join(DIST, f))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (!wgt) { console.error('O .wgt não foi gerado.'); process.exit(1); }
const final = join(DIST, 'VassoleSmartPlayer.wgt');
if (wgt !== final) renameSync(wgt, final);
console.log(`Pacote: ${final}`);
if (cmd === 'package') process.exit(0);

const tv = process.env.TIZEN_TV;
if (!tv) { console.error('Defina TIZEN_TV com o IP da TV (Modo Desenvolvedor ativo).'); process.exit(2); }
process.stdout.write(run(sdb, ['connect', tv]));
const target = run(sdb, ['devices']).split('\n').map((l) => l.trim().split(/\s+/)).find((p) => p[0] && p[0].startsWith(tv));
const name = target ? target[target.length - 1] : tv;
process.stdout.write(run(tizen, ['install', '-n', final, '-t', name]));
if (cmd === 'run') process.stdout.write(run(tizen, ['run', '-p', APP_ID, '-t', name]));
