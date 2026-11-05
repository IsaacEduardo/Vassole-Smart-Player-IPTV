// Testes de legendas (SRT/VTT, codificação, sincronia) e reconhecimento de idioma (Node 18+).
import assert from 'node:assert/strict';
import { decodeText, parseSubtitle, buildVtt, fmtOffset } from '../public/js/subs-core.js';
import { langOf, langName } from '../public/js/lang.js';

// ---- Codificação ----
const latin1 = Uint8Array.from([0x41, 0xe7, 0xe3, 0x6f, 0x20, 0xe9]); // "Ação é" em Windows-1252
assert.equal(decodeText(latin1), 'Ação é');
assert.equal(decodeText(new TextEncoder().encode('Ação é')), 'Ação é');
assert.equal(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('ok')])), 'ok', 'remove BOM UTF-8');
assert.equal(decodeText(Uint8Array.from([0xff, 0xfe, 0x41, 0x00, 0xe7, 0x00])), 'Aç', 'UTF-16 LE');
assert.equal(decodeText(Uint8Array.from([0x93, 0x4f, 0x69, 0x94])), '“Oi”', 'aspas do Windows-1252');
assert.throws(() => decodeText(Uint8Array.from([0x50, 0x4b, 3, 4])), /zip/);

// ---- SRT ----
const srt = `1\r\n00:00:01,500 --> 00:00:03,000\r\n<font color="#ffff00">Olá,</font> mundo!\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,250\r\n{\\an8}No topo\r\n<i>itálico</i>\r\n\r\n3\r\n00:00:07,000 --> 00:00:06,000\r\ninválida\r\n\r\n4\r\n01:02:03,4 --> 01:02:05,000\r\nhoras\r\n`;
const cues = parseSubtitle(srt);
assert.equal(cues.length, 3, 'descarta fala com fim antes do início');
assert.deepEqual(cues[0], { s: 1.5, e: 3, text: 'Olá, mundo!', top: false });
assert.equal(cues[1].text, 'No topo\n<i>itálico</i>');
assert.equal(cues[1].top, true);
assert.equal(cues[2].s, 3723.4);

// ---- VTT de entrada ----
const vtt = 'WEBVTT - título\n\nNOTE comentário\n\nSTYLE\n::cue { color: red }\n\nid1\n00:01.000 --> 00:02.000 align:start\nCurta\n\n00:00:03.000 --> 00:00:04.000\nA --> B\n';
const vc = parseSubtitle(vtt);
assert.equal(vc.length, 2);
assert.equal(vc[0].s, 1);
assert.equal(vc[1].text, 'A → B');
assert.throws(() => parseSubtitle('texto qualquer'), /Nenhuma fala/);

// ---- Saída e sincronia ----
assert.equal(buildVtt(cues.slice(0, 2)), 'WEBVTT\n\n00:00:01.500 --> 00:00:03.000\nOlá, mundo!\n\n00:00:04.000 --> 00:00:06.250 line:6%\nNo topo\n<i>itálico</i>\n');
const late = buildVtt(cues.slice(0, 1), { offset: 2 });
assert.ok(late.includes('00:00:03.500 --> 00:00:05.000'), 'atraso de 2 s');
const early = buildVtt(cues.slice(0, 2), { offset: -2 });
assert.ok(early.includes('00:00:00.000 --> 00:00:01.000'), 'adiantar corta no zero');
assert.ok(early.includes('00:00:02.000 --> 00:00:04.250'));
assert.equal(buildVtt(cues.slice(0, 1), { offset: -5 }), 'WEBVTT\n', 'fala que termina antes do zero some');
assert.ok(buildVtt(cues.slice(0, 1), { line: '78%' }).includes('00:00:03.000 line:78%'));
assert.deepEqual(parseSubtitle(buildVtt(cues)).map((c) => [c.s, c.e]), cues.map((c) => [c.s, c.e]), 'ida e volta');
assert.equal(fmtOffset(0), 'sem ajuste');
assert.equal(fmtOffset(1.5), '+1,5 s');
assert.equal(fmtOffset(-0.5), '−0,5 s');

// ---- Idiomas ----
assert.equal(langOf('por'), 'pt');
assert.equal(langOf('pt-BR'), 'pt');
assert.equal(langOf('', 'Português (Brasil)'), 'pt');
assert.equal(langOf('eng'), 'en');
assert.equal(langOf('English SDH'), 'en');
assert.equal(langOf('spa'), 'es');
assert.equal(langOf('Español Latino'), 'es');
assert.equal(langOf('Français'), 'fr');
assert.equal(langOf('und', 'Faixa 1'), '');
assert.equal(langOf(undefined, null), '');
assert.equal(langName('pt'), 'Português');
console.log('testes de legendas: ok');
