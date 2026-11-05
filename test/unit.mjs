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

assert.deepEqual(xtreamFromUrl('http://host:8080/get.php?username=a&password=b&type=m3u_plus&output=ts'), { server: 'http://host:8080', username: 'a', password: 'b' });
assert.equal(xtreamFromUrl('http://host/lista.m3u'), null);
assert.equal(normalizeServer('host.tv:8080/'), 'http://host.tv:8080');
assert.equal(normalizeServer('https://h.tv/player_api.php'), 'https://h.tv');
assert.equal(decodeEntities('a &lt;b&gt; &#x41;'), 'a <b> A');
assert.equal(normChannel('Canal Notícias HD'), 'canal noticias');
console.log('testes unitários: ok');
