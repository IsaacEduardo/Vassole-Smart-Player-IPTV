// Testes do build (dist/) e da camada de plataforma, em Node 18+.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as esbuild from 'esbuild';
import { buildPlatform, TARGET, lowerInset } from '../scripts/build.mjs';

// ---- inset → top/right/bottom/left ----
assert.equal(lowerInset('.a { inset: 0; }'), '.a { top:0;right:0;bottom:0;left:0; }');
assert.equal(lowerInset('.a{inset:0 0 0 var(--rail)}'), '.a{top:0;right:0;bottom:0;left:var(--rail)}');
assert.equal(lowerInset('.a { inset: 1px 2px; }'), '.a { top:1px;right:2px;bottom:1px;left:2px; }');
assert.equal(lowerInset('.a { box-shadow: inset 3px 0 0 red; }'), '.a { box-shadow: inset 3px 0 0 red; }', 'box-shadow inset intacto');
import { detectPlatform, capsFor, keyName } from '../public/js/platform.js';

// ---- Detecção de plataforma ----
assert.equal(detectPlatform({}), 'browser');
assert.equal(detectPlatform({ __PLATFORM__: 'tizen' }), 'tizen');
assert.equal(detectPlatform({ __PLATFORM__: 'xyz' }), 'browser');
assert.equal(detectPlatform({ Capacitor: { getPlatform: () => 'android' } }), 'android');
assert.equal(detectPlatform({ Capacitor: { getPlatform: () => 'web' } }), 'browser');
assert.equal(detectPlatform({ tizen: { tvinputdevice: {} } }), 'tizen');
assert.equal(detectPlatform({ PalmSystem: {} }), 'webos');
assert.equal(capsFor('browser', false).proxy, true);
assert.equal(capsFor('browser', true).serviceWorker, false, 'pacote sem service worker');
assert.equal(capsFor('tizen', true).proxy, false);
assert.equal(capsFor('tizen', true).exitOnBack, true);
assert.equal(capsFor('android', true).proxy, true, 'Android: proxy do próprio APK');

// ---- Teclas do controle ----
const k = (o) => keyName({ key: '', keyCode: 0, ...o });
assert.equal(k({ keyCode: 10009 }), 'back', 'Voltar Samsung');
assert.equal(k({ keyCode: 461 }), 'back', 'Voltar LG');
assert.equal(k({ keyCode: 10252 }), 'playpause');
assert.equal(k({ keyCode: 427 }), 'chup');
assert.equal(k({ keyCode: 403 }), 'red');
assert.equal(k({ key: 'ArrowLeft' }), 'left');
assert.equal(k({ key: 'MediaPlayPause' }), 'playpause');
assert.equal(k({ key: 'ChannelDown' }), 'chdown');
assert.equal(k({ key: '7' }), '7');
assert.equal(k({ keyCode: 53 }), '5', 'número só pelo keyCode (controles antigos)');
assert.equal(k({ keyCode: 8 }), null, 'Backspace pelo código não vira Voltar sozinho');
assert.equal(k({ key: 'Backspace', keyCode: 8 }), 'backspace');

// ---- Build ----
const out = mkdtempSync(join(tmpdir(), 'vassole-build-'));
try {
  // Operadores que o Chromium 56 não conhece. As strings são apagadas antes, para não confundir
  // um "?." dentro de um texto com o operador.
  // ?. seguido de dígito é ternário com número (a?.5:1); rest de parâmetros (a, ...b) é suportado.
  const MODERN = [/[\w$)\]]\?\.[A-Za-z_$([]/, /[\w$)\]]\s*\?\?[^=]/, /[\w$)\]]\s*\*\*\s*[\w$(]/, /\{\s*\.\.\.[\w$]/];
  const modernHits = (code) => {
    const bare = code.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""');
    return MODERN.map((re) => re.exec(bare)).filter(Boolean).map((m) => bare.slice(Math.max(0, m.index - 40), m.index + 40));
  };
  const fitsTarget = (code) => {
    const hits = modernHits(code);
    if (hits.length) console.error('sintaxe nova encontrada perto de:', hits);
    return !hits.length;
  };
  assert.ok(['const a = b?.c;', 'x = y ?? 1', 'const o = { ...p }'].every((c) => modernHits(c).length), 'o detector acha sintaxe nova');
  assert.ok(fitsTarget('const s = "a?.b ?? c"; const f = (...a) => [...a]; const t = a?.5:1;'), 'o detector ignora textos, rest e ternário com número');
  assert.equal(TARGET[0], 'chrome56');
  for (const platform of ['browser', 'tizen']) {
    const dir = await buildPlatform(platform, { outRoot: out });
    const app = readFileSync(join(dir, 'js', 'app.js'), 'utf8');
    const worker = readFileSync(join(dir, 'js', 'sync-worker.js'), 'utf8');
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    const css = readFileSync(join(dir, 'styles.css'), 'utf8');
    assert.ok(app.startsWith(`window.__PLATFORM__="${platform}";window.__BUNDLED__=true;`), `${platform}: plataforma gravada no bundle`);
    assert.ok(fitsTarget(app), `${platform}: app.js usa só sintaxe do Chromium 56`);
    assert.ok(fitsTarget(worker), `${platform}: sync-worker.js usa só sintaxe do Chromium 56`);
    assert.ok(!/\bimport\(/.test(app), `${platform}: sem import() dinâmico no bundle`);
    assert.ok(html.includes('<script src="js/app.js"></script>') && !html.includes('type="module"'), `${platform}: script clássico`);
    assert.ok(!existsSync(join(dir, 'sw.js')), `${platform}: sem service worker`);
    assert.ok(existsSync(join(dir, 'vendor', 'hls.min.js')) && existsSync(join(dir, 'fonts')), `${platform}: vendor e fontes copiados`);
    assert.ok(!/\binset:/.test(css), `${platform}: inset convertido para top/right/bottom/left`);
    if (platform === 'browser') assert.ok(css.includes(':focus-visible'), 'navegador mantém :focus-visible');
    else assert.ok(!css.includes(':focus-visible') && !html.includes('rel="manifest"'), 'TV: foco sempre visível e sem manifesto');
  }
  // As bibliotecas copiadas sem conversão também precisam rodar no Chromium 56.
  for (const f of ['hls.min.js', 'mpegts.js']) {
    assert.ok(fitsTarget(readFileSync(join(out, 'tizen', 'vendor', f), 'utf8')), `vendor/${f} usa só sintaxe do Chromium 56`);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
console.log('testes do build e da plataforma: ok');
