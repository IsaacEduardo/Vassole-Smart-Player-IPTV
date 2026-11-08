#!/usr/bin/env node
// Gera o app empacotável para cada plataforma em dist/<plataforma>/:
//   - js/app.js e js/sync-worker.js: um arquivo cada (sem ES modules), convertidos para Chromium 56
//     (TVs Samsung 2018+ e LG 2018+). A plataforma fica gravada em window.__PLATFORM__.
//   - styles.css convertido para o mesmo alvo. Fora do navegador, o realce de foco vale sempre
//     (:focus-visible vira :focus), porque nas TVs não há mouse.
//   - index.html com <script> clássico, fontes, ícones e bibliotecas de vendor/.
//   - Sem service worker: os pacotes já trazem os arquivos.
//
// Uso:  node scripts/build.mjs                  todas as plataformas
//       node scripts/build.mjs tizen webos      só as indicadas
//       node scripts/build.mjs --dev            sem minificar (para depurar na TV)
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PUB = join(ROOT, 'public');
const ALL = ['browser', 'android', 'tizen', 'webos'];
export const TARGET = ['chrome56'];

const pkg =JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

// inset (Chromium 87) → top/right/bottom/left, com as regras do atalho de 1 a 4 valores.
export function lowerInset(css) {
  return css.replace(/(^|[;{\s])inset\s*:\s*([^;}!]+?)(\s*!important)?\s*(?=[;}])/g, (m, pre, value, imp = '') => {
    const v = value.trim().split(/\s+/);
    if (v.length < 1 || v.length > 4) return m;
    const [top, right = top, bottom = top, left = right] = v;
    return `${pre}top:${top}${imp};right:${right}${imp};bottom:${bottom}${imp};left:${left}${imp}`;
  });
}

// Manifesto do app Tizen (TVs Samsung 2018+, Tizen 4.0). TIZEN_PACKAGE: id de 10 caracteres do pacote.
export const TIZEN_PACKAGE = 'VassolePly';
export function tizenConfig(info) {
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets"
        id="http://vassole.app/smartplayer" version="${esc(info.version)}" viewmodes="maximized">
  <tizen:application id="${TIZEN_PACKAGE}.SmartPlayer" package="${TIZEN_PACKAGE}" required_version="4.0"/>
  <tizen:profile name="tv-samsung"/>
  <content src="index.html"/>
  <icon src="icon.png"/>
  <name>Vassole Smart Player IPTV</name>
  <description>Player de IPTV para listas M3U e contas Xtream Codes. Não inclui canais nem conteúdo.</description>
  <feature name="http://tizen.org/feature/screen.size.all"/>
  <!-- Acesso aos provedores do usuário (listas, guias e streams em qualquer endereço). -->
  <access origin="*" subdomains="true"/>
  <tizen:privilege name="http://tizen.org/privilege/internet"/>
  <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
  <tizen:setting screen-orientation="landscape" context-menu="disable" background-support="disable"
                 encryption="disable" install-location="auto" hwkey-event="enable"/>
</widget>
`;
}

export async function buildPlatform(platform, { outRoot = join(ROOT, 'dist'), minify = true } = {}) {
  const out = join(outRoot, platform);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'js'), { recursive: true });
  const common = {
    bundle: true, format: 'iife', target: TARGET, minify, sourcemap: minify ? false : 'inline', legalComments: 'none',
    logLevel: 'warning', charset: 'utf8',
  };
  await esbuild.build({
    ...common,
    entryPoints: [join(PUB, 'js', 'app.js')],
    outfile: join(out, 'js', 'app.js'),
    banner: { js: `window.__PLATFORM__=${JSON.stringify(platform)};window.__BUNDLED__=true;window.__VERSION__=${JSON.stringify(pkg.version)};` },
  });
  await esbuild.build({
    ...common,
    entryPoints: [join(PUB, 'js', 'sync-worker.js')],
    outfile: join(out, 'js', 'sync-worker.js'),
    banner: { js: `self.__PLATFORM__=${JSON.stringify(platform)};self.__BUNDLED__=true;` },
  });

  let css = readFileSync(join(PUB, 'styles.css'), 'utf8');
  if (platform !== 'browser') css = css.replace(/:focus-visible/g, ':focus');
  css = lowerInset(css);
  const cssOut = await esbuild.transform(css, { loader: 'css', target: TARGET, minify, charset: 'utf8' });
  writeFileSync(join(out, 'styles.css'), cssOut.code);

  let html = readFileSync(join(PUB, 'index.html'), 'utf8')
    .replace('<script type="module" src="js/app.js"></script>', '<script src="js/app.js"></script>');
  if (platform !== 'browser') html = html.replace(/\s*<link rel="manifest"[^>]*>/, '');
  if (!html.includes('<script src="js/app.js"></script>')) throw new Error('index.html: tag do app.js não encontrada');
  // Samsung: APIs da TV (AVPlay) carregadas antes do app.
  if (platform === 'tizen') html = html.replace('<script src="js/app.js"></script>', '<script src="$WEBAPIS/webapis/webapis.js"></script>\n  <script src="js/app.js"></script>');
  writeFileSync(join(out, 'index.html'), html);

  for (const dir of ['fonts', 'icons', 'vendor']) cpSync(join(PUB, dir), join(out, dir), { recursive: true });
  // hls.js e mpegts.js passam pela mesma conversão: o pacote não depende de como foram compilados.
  for (const f of ['hls.min.js', 'mpegts.js']) {
    const src = readFileSync(join(PUB, 'vendor', f), 'utf8');
    const r = await esbuild.transform(src, { target: TARGET, minify: true, legalComments: 'inline', charset: 'utf8', logLevel: 'warning' });
    writeFileSync(join(out, 'vendor', f), r.code);
  }
  if (platform === 'browser') cpSync(join(PUB, 'manifest.webmanifest'), join(out, 'manifest.webmanifest'));
  if (platform === 'tizen') {
    writeFileSync(join(out, 'config.xml'), tizenConfig(pkg));
    cpSync(join(PUB, 'icons', 'icon-512.png'), join(out, 'icon.png'));
  }
  writeFileSync(join(out, 'build.json'), JSON.stringify({ app: pkg.name, version: pkg.version, platform, target: TARGET, built: new Date().toISOString() }, null, 2));
  return out;
}

// Executado pela linha de comando (e não importado pelos testes).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const dev = args.includes('--dev');
  const asked = args.filter((a) => !a.startsWith('--'));
  const bad = asked.filter((p) => !ALL.includes(p));
  if (bad.length) { console.error(`Plataforma desconhecida: ${bad.join(', ')}. Use: ${ALL.join(', ')}`); process.exit(2); }
  const platforms = asked.length ? asked : ALL;
  const t0 = Date.now();
  for (const p of platforms) {
    const out = await buildPlatform(p, { minify: !dev });
    console.log(`${p.padEnd(8)} → ${out}`);
  }
  console.log(`build ${pkg.version} pronto em ${((Date.now() - t0) / 1000).toFixed(1)} s${dev ? ' (sem minificar)' : ''}`);
}
