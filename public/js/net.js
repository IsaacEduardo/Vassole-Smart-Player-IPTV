// Acesso à rede. Em modo proxy, as requisições passam pelo servidor local (server.mjs),
// que acrescenta CORS e reescreve playlists HLS. Em modo direto, a origem precisa permitir CORS.

export function toNet(url, opts) {
  if (!opts || !opts.proxy || !/^https?:/i.test(url)) return url;
  const base = opts.base || (typeof location !== 'undefined' ? location.origin : '');
  return `${base}/proxy?u=${encodeURIComponent(url)}${opts.ua ? `&ua=${encodeURIComponent(opts.ua)}` : ''}${opts.ref ? `&ref=${encodeURIComponent(opts.ref)}` : ''}`;
}

export async function netFetch(url, opts, init = {}) {
  let r;
  try {
    r = await fetch(toNet(url, opts), init);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    // Nos apps (TV, Android) não há proxy: a plataforma vem gravada pelo build (página e worker).
    const g = typeof self !== 'undefined' ? self : {};
    const app = g.__PLATFORM__ && g.__PLATFORM__ !== 'browser';
    throw new Error(opts?.proxy
      ? 'Sem resposta do servidor local. Verifique se o server.mjs está em execução.'
      : app ? 'Sem resposta do servidor do provedor. Confira o endereço e a conexão de internet do aparelho.'
        : 'Falha de rede ou bloqueio de CORS. Ative o proxy nos Ajustes.');
  }
  if (!r.ok && r.status !== 206) {
    const t = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}${t && t.length < 200 ? ` — ${t}` : ''}`);
  }
  return r;
}

export async function fetchJSON(url, opts, init) {
  const r = await netFetch(url, opts, init);
  const t = await r.text();
  if (!t.trim()) return null;
  try { return JSON.parse(t); } catch { throw new Error('Resposta inválida do servidor (não é JSON)'); }
}

// Lê um corpo possivelmente compactado em gzip (ex.: guia .xml.gz) como fluxo de texto.
export async function textStream(response) {
  const reader = response.body.getReader();
  const first = await reader.read();
  const head = first.value || new Uint8Array();
  const src = new ReadableStream({
    start(c) { if (head.length) c.enqueue(head); if (first.done) c.close(); },
    async pull(c) {
      const { value, done } = await reader.read();
      if (done) c.close(); else c.enqueue(value);
    },
    cancel(r) { reader.cancel(r); },
  });
  const gz = head[0] === 0x1f && head[1] === 0x8b;
  if (gz && typeof DecompressionStream === 'undefined') {
    throw new Error('Este aparelho não descompacta guias .xml.gz. Use o endereço do guia sem compactação (.xml).');
  }
  const bytes = gz ? src.pipeThrough(new DecompressionStream('gzip')) : src;
  if (typeof TextDecoderStream !== 'undefined') return bytes.pipeThrough(new TextDecoderStream());
  // TVs com Chromium < 71: decodifica os pedaços à mão, sem TransformStream.
  const r2 = bytes.getReader();
  const dec = new TextDecoder();
  return new ReadableStream({
    async pull(c) {
      const { value, done } = await r2.read();
      if (done) { const tail = dec.decode(); if (tail) c.enqueue(tail); c.close(); return; }
      c.enqueue(dec.decode(value, { stream: true }));
    },
    cancel(r) { r2.cancel(r); },
  });
}
