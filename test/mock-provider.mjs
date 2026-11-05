// Provedor de teste: simula uma API Xtream Codes, uma lista M3U e um guia XMLTV,
// sem cabeçalhos CORS (como a maioria dos provedores reais). Só para testes locais.
import http from 'node:http';
import { createReadStream, statSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const PORT = Number(process.env.MOCK_PORT || 9100);
const MEDIA = fileURLToPath(new URL('./media/', import.meta.url));
const U = 'demo';
const PW = 'demo';
const base = `http://127.0.0.1:${PORT}`;

const liveCats = [{ category_id: '1', category_name: 'Notícias' }, { category_id: '2', category_name: 'Esportes' }];
const live = [
  { num: 1, name: 'Canal Notícias HD', stream_id: 101, stream_icon: '', epg_channel_id: 'noticias.br', category_id: '1', tv_archive: 0 },
  { num: 2, name: 'Jornal 24h', stream_id: 102, stream_icon: '', epg_channel_id: 'jornal24.br', category_id: '1', tv_archive: 0 },
  { num: 3, name: 'Esporte Total', stream_id: 103, stream_icon: '', epg_channel_id: 'esporte.br', category_id: '2', tv_archive: 0 },
  { num: 4, name: 'Arena Mais', stream_id: 104, stream_icon: '', epg_channel_id: '', category_id: '2', tv_archive: 0 },
  { num: 5, name: 'Sem Guia', stream_id: 105, stream_icon: '', epg_channel_id: '', category_id: null, tv_archive: 0 },
];
const vodCats = [{ category_id: '10', category_name: 'Documentários' }, { category_id: '11', category_name: 'Drama' }];
const vod = [
  { stream_id: 201, name: 'Oceano Profundo', stream_icon: '', category_id: '10', rating: '7.9', added: '1700000000', container_extension: 'mp4' },
  { stream_id: 202, name: 'Montanhas do Sul', stream_icon: '', category_id: '10', rating: '6.5', added: '1710000000', container_extension: 'mp4' },
  { stream_id: 203, name: 'A Última Estação', stream_icon: '', category_id: '11', rating: '8.4', added: '1720000000', container_extension: 'mp4' },
];
const seriesCats = [{ category_id: '20', category_name: 'Séries nacionais' }];
const series = [
  { series_id: 301, name: 'Cidade Alta', cover: '', category_id: '20', rating: '8.1', plot: 'Drama urbano.', releaseDate: '2024-03-01', last_modified: '1720000000' },
  { series_id: 302, name: 'Laboratório', cover: '', category_id: '20', rating: '7.2', plot: 'Ciência em casa.', releaseDate: '2025-01-10', last_modified: '1730000000' },
];
const episodes = (sid) => ({
  1: [1, 2].map((n) => ({ id: `${sid}${1}${n}`, episode_num: n, title: `Cidade Alta - S01E0${n} - Capítulo ${n}`, container_extension: 'mp4', season: 1, info: { duration: '00:01:00', plot: `Episódio ${n} da primeira temporada.` } })),
  2: [1].map((n) => ({ id: `${sid}${2}${n}`, episode_num: n, title: `Capítulo final`, container_extension: 'mp4', season: 2, info: { duration: '00:01:00', plot: 'Fim.' } })),
});

function xmltv() {
  const fmt = (t) => new Date(t).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
  const start = Math.floor(Date.now() / 1800000) * 1800000 - 2 * 3600e3;
  const chans = [['noticias.br', 'Canal Notícias'], ['jornal24.br', 'Jornal 24h'], ['esporte.br', 'Esporte Total'], ['arena.br', 'Arena Mais'], ['outro.br', 'Canal Fora da Lista']];
  let x = '<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="mock">\n';
  for (const [id, name] of chans) x += `<channel id="${id}"><display-name lang="pt">${name}</display-name><icon src="http://example.invalid/${id}.png"/></channel>\n`;
  for (const [id, name] of chans) {
    for (let i = 0; i < 16; i++) {
      const s = start + i * 1800000;
      x += `<programme start="${fmt(s)}" stop="${fmt(s + 1800000)}" channel="${id}"><title lang="pt">${name} &amp; Cia — bloco ${i + 1}</title><desc lang="pt">Descrição do bloco ${i + 1} de ${name}.</desc></programme>\n`;
    }
  }
  return `${x}</tv>\n`;
}

function m3u(withXtreamPaths) {
  let s = `#EXTM3U url-tvg="${base}/epg.xml"\n`;
  for (const c of live) {
    const url = withXtreamPaths ? `${base}/live/${U}/${PW}/${c.stream_id}.ts` : c.stream_id === 104 ? `${base}/stream/noext` : `${base}/hls/index.m3u8`;
    s += `#EXTINF:-1 tvg-id="${c.epg_channel_id}" tvg-name="${c.name}" tvg-logo="" group-title="${liveCats.find((k) => k.category_id === c.category_id)?.category_name || ''}",${c.name}\n${url}\n`;
  }
  for (const v of vod) s += `#EXTINF:-1 tvg-name="${v.name}" group-title="Filmes ${vodCats.find((k) => k.category_id === v.category_id).category_name}",${v.name}\n${base}/movie/${U}/${PW}/${v.stream_id}.mp4\n`;
  for (const n of [1, 2]) s += `#EXTINF:-1 group-title="Séries",Cidade Alta S01 E0${n}\n${base}/series/${U}/${PW}/3011${n}.mp4\n`;
  s += `#EXTINF:-1 group-title="Séries",Cidade Alta S02 E01\n${base}/series/${U}/${PW}/30121.mp4\n`;
  return s;
}

function sendFile(req, res, file, type) {
  const st = statSync(file);
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
  createReadStream(file).pipe(res);
}

const json = (res, v) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(v));

http.createServer((req, res) => {
  const url = new URL(req.url, base);
  const q = url.searchParams;
  const p = url.pathname;
  const auth = q.get('username') === U && q.get('password') === PW;

  if (p === '/player_api.php') {
    if (!auth) return json(res, { user_info: { auth: 0 } });
    const a = q.get('action');
    if (!a) return json(res, { user_info: { auth: 1, status: 'Active', exp_date: String(Math.floor(Date.now() / 1000) + 30 * 86400), is_trial: '0', active_cons: '0', max_connections: '2', allowed_output_formats: ['m3u8', 'ts'] }, server_info: { url: '127.0.0.1', port: String(PORT) } });
    if (a === 'get_live_categories') return json(res, liveCats);
    if (a === 'get_vod_categories') return json(res, vodCats);
    if (a === 'get_series_categories') return json(res, seriesCats);
    if (a === 'get_live_streams') return json(res, live);
    if (a === 'get_vod_streams') return json(res, vod);
    if (a === 'get_series') return json(res, series);
    if (a === 'get_vod_info') return json(res, { info: { plot: 'Um documentário de teste.', genre: 'Documentário', duration: '00:01:00', releasedate: '2023-05-01', rating: '7.9', cast: 'Elenco de teste', director: 'Direção de teste' }, movie_data: { stream_id: Number(q.get('vod_id')), container_extension: 'mp4' } });
    if (a === 'get_series_info') return json(res, { info: { name: 'Série', plot: 'Sinopse da série de teste.', genre: 'Drama', rating: '8.1', releaseDate: '2024-03-01' }, episodes: episodes(q.get('series_id')) });
    if (a === 'get_short_epg') {
      const now = Math.floor(Date.now() / 1000);
      const b = (s) => Buffer.from(s, 'utf8').toString('base64');
      return json(res, { epg_listings: [{ title: b('Programa ao vivo (guia curto)'), description: b('Descrição em base64.'), start_timestamp: String(now - 600), stop_timestamp: String(now + 1200) }, { title: b('Próximo programa'), description: b(''), start_timestamp: String(now + 1200), stop_timestamp: String(now + 3000) }] });
    }
    return json(res, []);
  }
  if (p === '/get.php') {
    if (!auth) return res.writeHead(401).end();
    return res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' }).end(m3u(true));
  }
  if (p === '/xmltv.php') {
    if (!auth) return res.writeHead(401).end();
    return res.writeHead(200, { 'Content-Type': 'application/gzip' }).end(gzipSync(xmltv()));
  }
  if (p === '/epg.xml') return res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' }).end(xmltv());
  if (p === '/m3u/list.m3u') return res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' }).end(m3u(false));
  if (p === '/stream/noext') return res.writeHead(302, { Location: '/hls/index.m3u8' }).end();

  let m = /^\/live\/([^/]+)\/([^/]+)\/(\d+)\.(m3u8|ts)$/.exec(p);
  if (m) {
    if (m[1] !== U || m[2] !== PW) return res.writeHead(401).end();
    // Redireciona como os balanceadores dos painéis Xtream.
    if (m[4] === 'm3u8') return res.writeHead(302, { Location: `/hls/index.m3u8?token=x${m[3]}` }).end();
    return sendFile(req, res, join(MEDIA, 'live.ts'), 'video/mp2t');
  }
  m = /^\/(movie|series)\/([^/]+)\/([^/]+)\/(\d+)\.(\w+)$/.exec(p);
  if (m) return sendFile(req, res, join(MEDIA, 'movie.mp4'), 'video/mp4');
  m = /^\/hls\/(index\.m3u8|seg\d+\.ts)$/.exec(p);
  if (m) {
    if (m[1] === 'index.m3u8') return res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }).end(readFileSync(join(MEDIA, 'hls', 'index.m3u8')));
    return sendFile(req, res, join(MEDIA, 'hls', m[1]), 'video/mp2t');
  }
  res.writeHead(404).end();
}).listen(PORT, '127.0.0.1', () => console.log(`provedor de teste em ${base}`));
