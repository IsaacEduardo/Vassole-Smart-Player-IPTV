// Testes da detecção de idioma e de versões (dublado/legendado), com casos de listas reais.
import assert from 'node:assert/strict';
import { detectLang, categoryLang, detectVersion, versionKey, langOf, langName } from '../public/js/lang.js';

const d = (name, group, extra = {}) => detectLang({ name, group, ...extra });

// ---- Prefixo no nome do canal ----
assert.deepEqual(d('PT: SIC FHD'), { lang: 'pt', dn: 'SIC FHD' });
assert.deepEqual(d('PT | RTP 1'), { lang: 'pt', dn: 'RTP 1' });
assert.deepEqual(d('[EN] CNN International'), { lang: 'en', dn: 'CNN International' });
assert.deepEqual(d('|FR| TF1 HD'), { lang: 'fr', dn: 'TF1 HD' });
assert.deepEqual(d('ES - La 1'), { lang: 'es', dn: 'La 1' });
assert.deepEqual(d('EX-YU: Sport Klub 5'), { lang: 'sh', dn: 'Sport Klub 5' });
assert.deepEqual(d('PL : 4FUN'), { lang: 'pl', dn: '4FUN' });
assert.deepEqual(d('AR: ON Drama'), { lang: 'ar', dn: 'ON Drama' }, 'AR = árabe nas listas IPTV');
assert.deepEqual(d('ARG: Telefe'), { lang: 'es', dn: 'Telefe' }, 'ARG = Argentina');
assert.deepEqual(d('LA: Cine Estelar'), { lang: 'es', dn: 'Cine Estelar' }, 'LA = latino');
assert.deepEqual(d('BR: Globo SP'), { lang: 'pt', dn: 'Globo SP' });
assert.deepEqual(d('USA Smithsonian Channel West'), { lang: 'en', dn: 'Smithsonian Channel West' });
assert.deepEqual(d('Latino: Telemundo'), { lang: 'es', dn: 'Telemundo' });
// Região com vários idiomas: tira o prefixo, mas o idioma vem da categoria.
assert.deepEqual(d('AF: (Senegal) RTS 1', 'Africa All'), { lang: '', dn: '(Senegal) RTS 1' });
assert.deepEqual(d('CH: SRF 1', 'CH: Switzerland General'), { lang: '', dn: 'SRF 1' });
// Sem prefixo: categoria.
assert.deepEqual(d('Globo SP', 'BR: Brazil General'), { lang: 'pt', dn: '' });
assert.deepEqual(d('24/7 Peppa Pig', '24/7 Teen Cartoons'), { lang: '', dn: '' });
// Títulos de filmes com dois-pontos não são prefixos.
for (const t of ['It: Chapter Two (2019)', 'Thor: Ragnarok (2017)', 'Dune: Part Two (2024)', 'Spider-Man: No Way Home (2021)', 'Alien: Romulus (2024)', 'No: The Movie']) {
  assert.deepEqual(d(t, 'Movie-Action'), { lang: '', dn: '' }, t);
}
// Atributos da lista M3U têm prioridade.
assert.equal(d('Canal X', '', { tvgLanguage: 'Portuguese' }).lang, 'pt');
assert.equal(d('Canal X', '', { tvgLanguage: 'spa,eng' }).lang, 'es');
assert.equal(d('Canal X', 'FR: Info', { tvgCountry: 'BR' }).lang, 'pt');
assert.equal(d('US: Canal', '', { tvgLanguage: 'French' }).lang, 'fr');
assert.equal(d('PT: SIC', '', { tvgLanguage: 'xx' }).lang, 'pt', 'tvg-language desconhecido cai no prefixo');

// ---- Categorias (nomes reais) ----
const cats = {
  'BR: Brazil General': 'pt', 'RO: Romania General': 'ro', 'DK: Denmark General': 'da', 'BIH: Bosnia General': 'sh', 'HR: Croatia General': 'sh',
  'MX: Mexico General': 'es', 'CA: Sportsnet +': 'en', 'FR: France Enfants': 'fr', 'AR: Syria': 'ar', 'UK: EPL Games': 'en', 'DE: Germany Sport': 'de',
  'USA News': 'en', 'USA Latin': 'en', Slovenia: 'sl', Bolivia: 'es', Chile: 'es', 'El Salvador': 'es', Norway: 'no', Philippines: 'tl', China: 'zh',
  'Latino All': 'es', Kurdistan: 'ku', 'Movies Spanish': 'es', 'Movies Portugal': 'pt', 'Movies Brazil': 'pt', 'Movies Germany': 'de',
  'Movies EX-YU': 'sh', 'Movies Arabic': 'ar', 'VOD ARAB': 'ar', 'Persian Movies': 'fa', 'Movies - Tamil': 'ta', 'Movies - Telugu': 'te',
  'Movies-Bollywood': 'hi', 'Movies India': 'hi', 'Hindi Series': 'hi', 'Spanish Series': 'es', 'Turkish Series Translated to Arabic': 'tr',
  'Korean Series Translated to Arabic': 'ko', 'Asian Series Arabic SUB': '', 'Movies - Arabic Subtitles': '', 'Egypt Series': 'ar',
  'Filmes Dublados': '', 'Movie-Action': '', 'Series-Drama': '', 'Server 7': '', 'Africa All': '', 'Sport NBA G League': '', 'Nepal': '',
  'PT | NOTÍCIAS': 'pt', '[EN] NEWS': 'en', 'Notícias': '', 'Esportes': '',
};
for (const [name, want] of Object.entries(cats)) assert.equal(categoryLang(name), want, name);

// ---- Versões ----
const vers = {
  'Matrix [DUB]': 'dub', 'Matrix (LEG)': 'leg', 'Matrix - DUB': 'dub', 'Matrix Dublado': 'dub', 'Matrix (Legendado)': 'leg',
  'Matrix [DUAL]': 'dual', 'Matrix Dual Áudio': 'dual', 'Amélie VOSTFR': 'leg', 'Matrix (1999)': '', 'Peg Leg Pete': '', 'Dub Reggae Live': '',
};
for (const [name, want] of Object.entries(vers)) assert.equal(detectVersion(name), want, name);
assert.equal(detectVersion('Matrix (1999)', 'Filmes Legendados'), 'leg', 'versão pela categoria');
assert.equal(detectVersion('Matrix [DUB]', 'Filmes Legendados'), 'dub', 'o nome vence a categoria');
assert.equal(versionKey('Matrix (1999) [DUB]'), versionKey('Matrix (1999) [LEG]'));
assert.equal(versionKey('Matrix (1999) - Dublado'), 'matrix 1999');
assert.equal(versionKey('BR: Matrix (1999) (Legendado)'), 'matrix 1999');
assert.notEqual(versionKey('Matrix (1999)'), versionKey('Matrix Reloaded (2003)'));

// ---- Códigos de faixa ----
assert.equal(langOf('hrv'), 'sh');
assert.equal(langOf('ara'), 'ar');
assert.equal(langName('sh'), 'Servo-croata');
console.log('testes de idiomas: ok');
