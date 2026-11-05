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
    throw new Error(opts?.proxy
      ? 'Sem resposta do servidor local. Verifique se o server.mjs está em execução.'
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
  if (gz && typeof DecompressionStream === 'undefined') throw new Error('Este navegador não descompacta guias .gz');
  const bytes = gz ? src.pipeThrough(new DecompressionStream('gzip')) : src;
  return bytes.pipeThrough(new TextDecoderStream());
}
