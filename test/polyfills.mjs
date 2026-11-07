// Testes dos complementos para TVs antigas: apaga os métodos nativos e confere as versões do app.
// Roda em processo próprio, porque altera os protótipos globais.
import assert from 'node:assert/strict';

delete String.prototype.padStart;
delete String.prototype.padEnd;
delete Array.prototype.flat;
delete Array.prototype.flatMap;
delete String.prototype.matchAll;
const savedTDS = globalThis.TextDecoderStream;
delete globalThis.TextDecoderStream;

await import('../public/js/polyfills.js');
const { textStream } = await import('../public/js/net.js');

assert.equal('5'.padStart(3, '0'), '005');
assert.equal('abc'.padStart(2), 'abc');
assert.equal('ab'.padEnd(5, 'xy'), 'abxyx');
assert.deepEqual([1, [2, [3]], 4].flat(), [1, 2, [3], 4]);
assert.deepEqual([1, [2, [3]]].flat(2), [1, 2, 3]);
assert.deepEqual([1, 2].flatMap((x) => [x, x * 10]), [1, 10, 2, 20]);
assert.deepEqual([...'a1b22'.matchAll(/(\d+)/g)].map((m) => m[1]), ['1', '22']);
assert.deepEqual([...'aXbX'.matchAll(/x/gi)].map((m) => m.index), [1, 3]);

// Guia lido sem TextDecoderStream (Chromium < 71), com caracteres de vários bytes cortados entre pedaços.
const text = '<tv>Ação ✓ çã</tv>'.repeat(3);
const bytes = new TextEncoder().encode(text);
const body = new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 5) c.enqueue(bytes.slice(i, i + 5)); c.close(); } });
let out = '';
const r = (await textStream({ body })).getReader();
for (;;) { const { value, done } = await r.read(); if (done) break; out += value; }
assert.equal(out, text);
globalThis.TextDecoderStream = savedTDS;
console.log('testes dos polyfills: ok');
