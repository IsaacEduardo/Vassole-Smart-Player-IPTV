// Testes dos leitores de M3U e XMLTV (Node 18+).
import assert from 'node:assert/strict';
import { parseM3U, buildFromM3U, classify } from '../public/js/m3u.js';
import { parseXmltv, parseXmltvDate } from '../public/js/xmltv.js';
import { xtreamFromUrl, normalizeServer } from '../public/js/xtream.js';
import { decodeEntities, normChannel } from '../public/js/util.js';

const text = `#EXTM3U x-tvg-url="http://e/guia.xml.gz"
#EXTINF:-1 tvg-id="a.br" tvg-name="Canal A" tvg-logo="http://l/a.png" group-title="Abertos, HD",Canal A HD
#EXTVLCOPT:http-user-agent=X
http://s/live/1.ts
#EXTINF:-1 group-title="Filmes",Filme Um (2020)
http://s/movie/u/p/9.mkv
#EXTINF:-1 group-title="Séries",Show X S02E03 O retorno
http://s/series/u/p/77.mp4
#EXTINF:-1 group-title="Séries",Show X S02 E01
http://s/series/u/p/75.mp4
http://s/sem-info.m3u8
`;
const { header, entries } = parseM3U(text);
assert.equal(header.epg, 'http://e/guia.xml.gz');
assert.equal(entries.length, 5);
assert.equal(entries[0].group, 'Abertos, HD');
assert.equal(entries[0].name, 'Canal A HD');
assert.equal(classify(entries[0]), 'live');
assert.equal(classify(entries[1]), 'movie');
assert.equal(classify(entries[2]), 'series');
const b = buildFromM3U('p1', text);
assert.deepEqual(b.counts, { live: 2, movie: 1, series: 1 });
const s = b.items.find((i) => i.kind === 'series');
assert.equal(s.name, 'Show X');
assert.deepEqual(s.episodes.map((e) => [e.season, e.episode]), [[2, 1], [2, 3]]);
assert.equal(s.episodes[1].title, 'O retorno');
assert.equal(b.items.find((i) => i.kind === 'live').epgId, 'a.br');
// ids estáveis entre leituras
assert.deepEqual(buildFromM3U('p1', text).items.map((i) => i.id), b.items.map((i) => i.id));

assert.equal(parseXmltvDate('20261105120000 +0100'), Date.UTC(2026, 10, 5, 11, 0, 0));
assert.equal(parseXmltvDate('20261105120000'), Date.UTC(2026, 10, 5, 12, 0, 0));
const xml = `<tv><channel id="A.br"><display-name>Canal A</display-name><icon src="x.png"/></channel>
<programme start="20261105120000 +0000" stop="20261105130000 +0000" channel="A.br"><title>Jornal &amp; Cia</title><desc><![CDATA[Desc <b>]]></desc></programme>
<programme start="20261105130000 +0000" stop="20261105140000 +0000" channel="A.br"><title>Filme &#233;pico</title></programme></tv>`;
// Entrega em pedaços pequenos para testar elementos divididos entre blocos.
const stream = new ReadableStream({ start(c) { for (let i = 0; i < xml.length; i += 7) c.enqueue(xml.slice(i, i + 7)); c.close(); } });
const ch = []; const pr = [];
await parseXmltv(stream, { onChannel: (c) => ch.push(c), onProgramme: (p) => pr.push(p) });
assert.equal(ch.length, 1); assert.equal(ch[0].icon, 'x.png'); assert.deepEqual(ch[0].names, ['Canal A']);
assert.equal(pr.length, 2); assert.equal(pr[0].t, 'Jornal & Cia'); assert.equal(pr[0].d, 'Desc <b>'); assert.equal(pr[1].t, 'Filme épico');

// Guia com títulos em vários idiomas: usa o preferido, senão o primeiro.
const multi = `<tv><programme start="20261105120000 +0000" stop="20261105130000 +0000" channel="a"><title lang="en">News</title><title lang="pt">Notícias</title><desc lang="en">Daily</desc></programme></tv>`;
const one = (langs) => new Promise((res) => {
  const st = new ReadableStream({ start(c) { c.enqueue(multi); c.close(); } });
  parseXmltv(st, { langs, onProgramme: res });
});
assert.equal((await one(['pt'])).t, 'Notícias');
assert.equal((await one(['fr', 'en'])).t, 'News');
assert.equal((await one([])).t, 'News');
assert.equal((await one(['pt'])).d, 'Daily', 'sem descrição no idioma preferido, usa a que houver');

// Idioma, nome sem prefixo e versões na leitura de M3U.
const m3uLang = `#EXTM3U
#EXTINF:-1 tvg-language="Portuguese" group-title="Notícias",Canal Sem Prefixo
http://s/live/a.ts
#EXTINF:-1 group-title="FR: France General",FR: TF1 HD
http://s/live/b.ts
#EXTINF:-1 group-title="Filmes Dublados",Matrix (1999)
http://s/movie/u/p/1.mp4
#EXTINF:-1 group-title="Filmes Legendados",Matrix (1999)
http://s/movie/u/p/2.mp4
#EXTINF:-1 group-title="Séries",Show Y [LEG] S01E01
http://s/series/u/p/5.mp4
`;
const bl = buildFromM3U('p2', m3uLang);
const byName = (n) => bl.items.find((i) => i.name === n);
assert.equal(byName('Canal Sem Prefixo').lang, 'pt');
assert.equal(byName('FR: TF1 HD').lang, 'fr');
assert.equal(byName('FR: TF1 HD').dn, 'TF1 HD');
assert.equal(bl.categories.find((c) => c.name === 'FR: France General').lang, 'fr');
const mats = bl.items.filter((i) => i.kind === 'movie');
assert.deepEqual(mats.map((m) => m.ver).sort(), ['dub', 'leg']);
assert.equal(mats[0].vkey, mats[1].vkey, 'mesma chave de versão');
const showY = bl.items.find((i) => i.kind === 'series');
assert.equal(showY.ver, 'leg');
assert.equal(showY.vkey, 'show y');

// Cabeçalhos por canal (EXTVLCOPT, EXTHTTP, formato Kodi) e tvg-shift.
const m3uHdr = `#EXTM3U tvg-shift="-1"
#EXTINF:-1 tvg-shift="2",Canal VLC
#EXTVLCOPT:http-user-agent=VLC/3.0
#EXTVLCOPT:http-referrer=https://site.example/
http://s/live/1.m3u8
#EXTINF:-1,Canal HTTP
#EXTHTTP:{"User-Agent":"Kodi/20","Referer":"https://outro.example/"}
http://s/live/2.ts
#EXTINF:-1,Canal Kodi
http://s/live/3.m3u8|User-Agent=Mozilla%2F5.0&Referer=https://k.example/
#EXTINF:-1,Canal Simples
http://s/live/4.ts
`;
const bh = buildFromM3U('p3', m3uHdr).items;
const chn = (n) => bh.find((i) => i.name === n);
assert.deepEqual([chn('Canal VLC').ua, chn('Canal VLC').ref, chn('Canal VLC').shift], ['VLC/3.0', 'https://site.example/', 2]);
assert.deepEqual([chn('Canal HTTP').ua, chn('Canal HTTP').ref], ['Kodi/20', 'https://outro.example/']);
assert.deepEqual([chn('Canal Kodi').url, chn('Canal Kodi').ua, chn('Canal Kodi').ref], ['http://s/live/3.m3u8', 'Mozilla/5.0', 'https://k.example/']);
assert.equal(chn('Canal Simples').ua, undefined, 'opções não vazam para o próximo canal');
assert.equal(chn('Canal Simples').shift, -1, 'tvg-shift do cabeçalho');

assert.deepEqual(xtreamFromUrl('http://host:8080/get.php?username=a&password=b&type=m3u_plus&output=ts'), { server: 'http://host:8080', username: 'a', password: 'b' });
assert.equal(xtreamFromUrl('http://host/lista.m3u'), null);
assert.equal(normalizeServer('host.tv:8080/'), 'http://host.tv:8080');
assert.equal(normalizeServer('https://h.tv/player_api.php'), 'https://h.tv');
assert.equal(decodeEntities('a &lt;b&gt; &#x41;'), 'a <b> A');
assert.equal(normChannel('Canal Notícias HD'), 'canal noticias');
console.log('testes unitários: ok');
