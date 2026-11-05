// Leitura incremental de guias XMLTV (não carrega o arquivo inteiro na memória).
import { decodeEntities } from './util.js';
import { langOf } from './lang.js';

export function parseXmltvDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(String(s || '').trim());
  if (!m) return NaN;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (!m[7]) return t;
  const sign = m[7][0] === '-' ? -1 : 1;
  const off = sign * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(3, 5)));
  return t - off * 60000;
}

const attr = (s, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(s);
  return m ? decodeEntities(m[2] ?? m[3]) : '';
};
// Texto do elemento; com vários idiomas (<title lang="pt">), usa o primeiro da lista `langs` que existir.
const text = (s, tag, langs) => {
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, 'g');
  let first = null;
  let best = null;
  let bestRank = Infinity;
  for (const m of s.matchAll(re)) {
    const val = decodeEntities(m[2].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')).trim();
    if (first === null) first = val;
    if (!langs || !langs.length) break;
    const r = langs.indexOf(langOf(attr(m[1], 'lang')));
    if (r > -1 && r < bestRank) { bestRank = r; best = val; }
  }
  return best ?? first ?? '';
};
const texts = (s, tag) => {
  const out = [];
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  let m;
  while ((m = re.exec(s))) out.push(decodeEntities(m[1]).trim());
  return out;
};

// stream: ReadableStream<string>
export async function parseXmltv(stream, { onChannel, onProgramme, onProgress, langs }) {
  const reader = stream.getReader();
  let buf = '';
  let read = 0;
  let lastReport = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) { buf += value; read += value.length; }
    let pos = 0;
    let ip = -2; let ic = -2;
    for (;;) {
      // Posições em cache: evita varrer o buffer inteiro a cada elemento.
      if (ip !== -1 && ip < pos) ip = buf.indexOf('<programme', pos);
      if (ic !== -1 && ic < pos) ic = buf.indexOf('<channel', pos);
      let start; let kind;
      if (ip < 0 && ic < 0) break;
      if (ic >= 0 && (ip < 0 || ic < ip)) { start = ic; kind = 'channel'; } else { start = ip; kind = 'programme'; }
      const close = `</${kind}>`;
      const tagEnd = buf.indexOf('>', start);
      if (tagEnd < 0) { pos = start; break; }
      let end;
      if (buf[tagEnd - 1] === '/') end = tagEnd + 1;
      else {
        const ce = buf.indexOf(close, tagEnd);
        if (ce < 0) { pos = start; break; }
        end = ce + close.length;
      }
      const el = buf.slice(start, end);
      const open = buf.slice(start, tagEnd + 1);
      if (kind === 'channel') {
        onChannel?.({ id: attr(open, 'id'), names: texts(el, 'display-name'), icon: attr(el.slice(el.indexOf('<icon')), 'src') });
      } else {
        const s = parseXmltvDate(attr(open, 'start'));
        const e = parseXmltvDate(attr(open, 'stop'));
        if (Number.isFinite(s)) onProgramme?.({ ch: attr(open, 'channel'), s, e: Number.isFinite(e) ? e : s + 3600000, t: text(el, 'title', langs), d: text(el, 'desc', langs) });
      }
      pos = end;
    }
    buf = pos > 0 ? buf.slice(pos) : buf;
    if (buf.length > 4 * 1024 * 1024 && buf.indexOf('<programme') < 0 && buf.indexOf('<channel') < 0) buf = buf.slice(-64);
    if (onProgress && read - lastReport > 2e6) { lastReport = read; onProgress(read); }
    if (done) break;
  }
}
