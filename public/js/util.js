// Funções utilitárias sem dependência do DOM (também usadas no worker).

export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Nome de canal sem marcadores comuns de qualidade, para casar com o EPG por nome.
export function normChannel(s) {
  return norm(s).replace(/\b(fhd|uhd|hd|sd|4k|hevc|h265|h 265|backup|alt|2160p|1080p|720p|576p|480p|full hd)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

// Qualidade indicada no nome do canal. rank maior = melhor imagem. HEVC/H.265 perde meio ponto:
// a maioria dos navegadores não o reproduz. Sem indicação: rank 2 (como HD) e rótulo vazio.
export function channelQuality(name) {
  const s = norm(name);
  let rank = 2;
  let label = '';
  if (/\b(4k|uhd|2160p?)\b/.test(s)) { rank = 4; label = '4K'; }
  else if (/\b(fhd|1080p?|full hd)\b/.test(s)) { rank = 3; label = 'FHD'; }
  else if (/\b(hd|720p?)\b/.test(s)) { rank = 2; label = 'HD'; }
  else if (/\b(sd|480p?|576p?)\b/.test(s)) { rank = 1; label = 'SD'; }
  if (/\b(hevc|h265|h 265)\b/.test(s)) { rank -= 0.5; label = label ? `${label} HEVC` : 'HEVC'; }
  if (/\b(backup|alt)\b/.test(s)) { rank -= 0.1; label = label ? `${label} reserva` : 'Reserva'; }
  return { rank, label };
}

export const itemKey =(pid, kind, id) => `${pid}|${kind}|${id}`;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  if (!s || s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

export function b64utf8(s) {
  if (!s) return '';
  try {
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch { return s; }
}
