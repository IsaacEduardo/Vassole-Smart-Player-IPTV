// Leitura de legendas SRT e WebVTT, conversão para WebVTT e ajuste de sincronia. Sem DOM.

// Bytes do arquivo -> texto. Tenta UTF-8 e, se não for válido, usa Windows-1252
// (codificação comum em legendas em português).
export function decodeText(bytes) {
  let b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0x50 && b[1] === 0x4b) throw new Error('Arquivo compactado (.zip). Extraia o .srt antes de carregar.');
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return new TextDecoder('windows-1252').decode(b);
  }
}

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;
function seconds(s) {
  const m = TIME.exec(s);
  if (!m) return NaN;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

function cleanText(t) {
  return t
    .replace(/\{\\[^}]*\}/g, '') // marcas de estilo do SRT/ASS, ex.: {\an8}
    .replace(/<\/?font[^>]*>/gi, '') // <font> não existe em WebVTT
    .replace(/-->/g, '→')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

// Texto SRT ou WebVTT -> [{ s, e, text, top }] em segundos, ordenado.
export function parseSubtitle(text) {
  const src = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = src.split(/\n[ \t]*\n/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const s = seconds(a);
    const e = seconds(b);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
    const raw = lines.slice(i + 1).join('\n');
    const body = cleanText(raw);
    if (!body) continue;
    cues.push({ s, e, text: body, top: /\{\\an[789]\}/.test(raw) || /\bline:\s*[0-9](?:\.\d+)?%/.test(b) });
  }
  if (!cues.length) throw new Error('Nenhuma fala reconhecida. Use um arquivo .srt ou .vtt.');
  return cues.sort((x, y) => x.s - y.s);
}

function stamp(sec) {
  const ms = Math.round(sec * 1000);
  const hh = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const mm = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${hh}:${mm}:${ss}.${String(ms % 1000).padStart(3, '0')}`;
}

// Gera WebVTT. offset (s): positivo atrasa a legenda. line: posição vertical ('' = padrão do navegador).
export function buildVtt(cues, { offset = 0, line = '' } = {}) {
  const out = ['WEBVTT', ''];
  for (const c of cues) {
    const s = Math.max(0, c.s + offset);
    const e = c.e + offset;
    if (e <= s) continue;
    const pos = line ? ` line:${line}` : c.top ? ' line:6%' : '';
    out.push(`${stamp(s)} --> ${stamp(e)}${pos}`, c.text, '');
  }
  return out.join('\n');
}

export function fmtOffset(o) {
  if (!o) return 'sem ajuste';
  return `${o > 0 ? '+' : '−'}${Math.abs(o).toFixed(1).replace('.', ',')} s`;
}
