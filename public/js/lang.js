// Idiomas: nomes exibidos, reconhecimento por código ou nome, e detecção do idioma de canais,
// filmes e séries a partir de atributos, prefixos ("PT:", "[EN]", "|FR|") e nomes de categoria.
// Sem DOM: usado pela página, pelo worker de sincronização e pelos testes.
import { norm } from './util.js';

// keys: códigos e nomes do idioma (faixas de áudio e legenda, tvg-language, nomes de categoria).
export const LANGS = [
  { code: 'pt', name: 'Português', keys: ['pt', 'por', 'pob', 'ptb', 'portugues', 'portuguese', 'brazilian'] },
  { code: 'en', name: 'Inglês', keys: ['en', 'eng', 'english', 'ingles'] },
  { code: 'es', name: 'Espanhol', keys: ['es', 'spa', 'esp', 'spanish', 'espanol', 'castellano', 'latino', 'latin'] },
  { code: 'fr', name: 'Francês', keys: ['fr', 'fra', 'fre', 'french', 'francais', 'frances'] },
  { code: 'it', name: 'Italiano', keys: ['it', 'ita', 'italian', 'italiano'] },
  { code: 'de', name: 'Alemão', keys: ['de', 'deu', 'ger', 'german', 'deutsch', 'alemao'] },
  { code: 'ar', name: 'Árabe', keys: ['ar', 'ara', 'arab', 'arabic', 'arabe'] },
  { code: 'tr', name: 'Turco', keys: ['tr', 'tur', 'turkish', 'turkce'] },
  { code: 'nl', name: 'Holandês', keys: ['nl', 'nld', 'dut', 'dutch', 'nederlands'] },
  { code: 'pl', name: 'Polonês', keys: ['pl', 'pol', 'polish', 'polski'] },
  { code: 'ro', name: 'Romeno', keys: ['ro', 'ron', 'rum', 'romanian'] },
  { code: 'ru', name: 'Russo', keys: ['ru', 'rus', 'russian'] },
  { code: 'el', name: 'Grego', keys: ['el', 'ell', 'gre', 'greek'] },
  { code: 'sh', name: 'Servo-croata', keys: ['sh', 'srp', 'hrv', 'bos', 'serbian', 'croatian', 'bosnian'] },
  { code: 'sq', name: 'Albanês', keys: ['sq', 'sqi', 'alb', 'albanian', 'shqip'] },
  { code: 'hu', name: 'Húngaro', keys: ['hu', 'hun', 'hungarian', 'magyar'] },
  { code: 'bg', name: 'Búlgaro', keys: ['bg', 'bul', 'bulgarian'] },
  { code: 'cs', name: 'Tcheco', keys: ['cs', 'ces', 'cze', 'czech'] },
  { code: 'sv', name: 'Sueco', keys: ['sv', 'swe', 'swedish', 'svenska'] },
  { code: 'no', name: 'Norueguês', keys: ['no', 'nor', 'nob', 'norwegian', 'norsk'] },
  { code: 'da', name: 'Dinamarquês', keys: ['da', 'dan', 'danish', 'dansk'] },
  { code: 'fi', name: 'Finlandês', keys: ['fi', 'fin', 'finnish', 'suomi'] },
  { code: 'he', name: 'Hebraico', keys: ['he', 'heb', 'hebrew'] },
  { code: 'fa', name: 'Persa', keys: ['fa', 'fas', 'per', 'persian', 'farsi'] },
  { code: 'ku', name: 'Curdo', keys: ['ku', 'kur', 'kurdish'] },
  { code: 'hi', name: 'Hindi', keys: ['hi', 'hin', 'hindi'] },
  { code: 'ta', name: 'Tâmil', keys: ['ta', 'tam', 'tamil'] },
  { code: 'te', name: 'Telugu', keys: ['te', 'tel', 'telugu'] },
  { code: 'ml', name: 'Malaiala', keys: ['ml', 'mal', 'malayalam'] },
  { code: 'pa', name: 'Punjabi', keys: ['pa', 'pan', 'punjabi'] },
  { code: 'bn', name: 'Bengali', keys: ['bn', 'ben', 'bengali', 'bangla'] },
  { code: 'ur', name: 'Urdu', keys: ['ur', 'urd', 'urdu'] },
  { code: 'zh', name: 'Chinês', keys: ['zh', 'zho', 'chi', 'chinese', 'mandarin', 'cantonese'] },
  { code: 'ko', name: 'Coreano', keys: ['ko', 'kor', 'korean'] },
  { code: 'ja', name: 'Japonês', keys: ['ja', 'jpn', 'japanese'] },
  { code: 'vi', name: 'Vietnamita', keys: ['vi', 'vie', 'vietnamese'] },
  { code: 'th', name: 'Tailandês', keys: ['th', 'tha', 'thai'] },
  { code: 'id', name: 'Indonésio', keys: ['id', 'ind', 'indonesian'] },
  { code: 'tl', name: 'Filipino', keys: ['tl', 'fil', 'tagalog', 'filipino'] },
  { code: 'mk', name: 'Macedônio', keys: ['mk', 'mkd', 'mac', 'macedonian'] },
  { code: 'uk', name: 'Ucraniano', keys: ['uk', 'ukr', 'ukrainian'] },
  { code: 'sl', name: 'Esloveno', keys: ['sl', 'slv', 'slovenian', 'slovene'] },
  { code: 'sk', name: 'Eslovaco', keys: ['sk', 'slk', 'slo', 'slovak'] },
  { code: 'ms', name: 'Malaio', keys: ['ms', 'msa', 'may', 'malay'] },
];

const BY_KEY = new Map(LANGS.flatMap((l) => l.keys.map((k) => [k, l.code])));
const BY_NAME = new Map(LANGS.flatMap((l) => l.keys.filter((k) => k.length > 3).map((k) => [k, l.code])));

// Etiquetas de região usadas como prefixo por provedores ("BR:", "EX-YU:", "LA:") e nomes de país
// em categorias ("Movies Brazil", "Bolivia"). '' = região conhecida, mas com vários idiomas.
const REGION_TAGS = {
  pt: 'PT BR POR', en: 'US USA UK GB EN CA AU NZ IE', es: 'ES MX LA LAT LATAM LATINO ARG CO CL PE VE EC UY PY BO CR PA DO CU GT HN SV NI PR',
  fr: 'FR', it: 'IT', de: 'DE AT GER', ar: 'AR ARAB ARB KSA ALG MAR EG LB SY IQ JO KW BH OM PS QA TN LY SA AE', tr: 'TR TUR', nl: 'NL', pl: 'PL',
  ro: 'RO', ru: 'RU', el: 'GR CY', sh: 'EX-YU EXYU YU RS SRB HR CRO BIH BA ME', sq: 'AL ALB KS', hu: 'HU', bg: 'BG', cs: 'CZ', sk: 'SK',
  sv: 'SE', no: 'NO', da: 'DK', fi: 'FI', he: 'IL', fa: 'IR', ku: 'KRD KU', hi: 'IN', bn: 'BD', ur: 'PK', zh: 'CN HK TW', ko: 'KR',
  ja: 'JP', vi: 'VN', th: 'TH', id: 'ID', tl: 'PH', mk: 'MK', uk: 'UA', sl: 'SI', ms: 'MY', '': 'AF CH BE INT XXX',
};
const COUNTRY_NAMES = {
  pt: 'portugal brasil brazil angola mocambique', en: 'usa america american england british britain australia australian ireland irish canada',
  es: 'spain espana mexico mexican argentina argentinian colombia chile peru venezuela ecuador uruguay paraguay bolivia cuba dominican honduras panama nicaragua salvador guatemala',
  fr: 'france', it: 'italy italia', de: 'germany deutschland austria', tr: 'turkey turkiye', nl: 'netherlands netherland holland', pl: 'poland polska',
  ro: 'romania', ru: 'russia', el: 'greece cyprus', sh: 'serbia croatia bosnia montenegro', sq: 'albania kosovo', hu: 'hungary', bg: 'bulgaria',
  cs: 'czech czechia', sk: 'slovakia', sv: 'sweden', no: 'norway', da: 'denmark', fi: 'finland', he: 'israel', ku: 'kurdistan',
  ar: 'egypt syria lebanon iraq jordan kuwait bahrain oman palestine yemen sudan qatar algeria tunisia libya morocco mauritania saudi emirates egyptian syrian lebanese moroccan algerian iraqi ramadan',
  hi: 'india indian bollywood', bn: 'bangladesh', ur: 'pakistan pakistani', zh: 'china taiwan', ko: 'korea', ja: 'japan', vi: 'vietnam', th: 'thailand',
  id: 'indonesia', tl: 'philippines', mk: 'macedonia', uk: 'ukraine', sl: 'slovenia', ms: 'malaysia malaysian', fa: 'iran iranian persia',
};
const REGION = new Map(Object.entries(REGION_TAGS).flatMap(([c, s]) => s.split(' ').map((t) => [t, c])));
const COUNTRY = new Map(Object.entries(COUNTRY_NAMES).flatMap(([c, s]) => s.split(' ').map((t) => [t, c])));

export const langName = (code) => LANGS.find((l) => l.code === code)?.name || '';

// Código do idioma ('pt', 'en'…) do primeiro texto reconhecido, ou ''.
// Aceita códigos de faixa ("por", "pt-BR") e rótulos ("Português (Brasil)", "English SDH").
export function langOf(...texts) {
  for (const t of texts) {
    for (const w of norm(t).split(' ')) {
      const c = BY_KEY.get(w);
      if (c) return c;
    }
  }
  return '';
}

// Prefixo de região: "PT: SIC", "PT | SIC", "[EN] CNN", "|FR| TF1", "ES - TVE", "EX-YU: Arena", "USA Fox".
const PREFIX = /^\s*[[(|]?\s*([A-Za-z]{2,6}(?:-[A-Za-z]{2,3})?)\s*(?:[\]):|]|\s-\s)\s*/;
const USA = /^\s*USA\s+(?=\S)/;

function prefixOf(s) {
  const text = String(s || '');
  const m = PREFIX.exec(text);
  if (m) {
    const tag = m[1].toUpperCase();
    // Códigos de região só em maiúsculas, como os provedores escrevem: evita títulos como "It: A Coisa".
    if (REGION.has(tag) && m[1] === tag) return { lang: REGION.get(tag), rest: text.slice(m[0].length).trim() };
    const byName = BY_NAME.get(norm(tag));
    if (byName) return { lang: byName, rest: text.slice(m[0].length).trim() };
  }
  const u = USA.exec(text);
  if (u) return { lang: 'en', rest: text.slice(u[0].length).trim() };
  return null;
}

// Idioma de uma categoria pelo nome: prefixo, ou o primeiro nome de idioma ou país.
// "Arabic SUB" e "Translated to Arabic" indicam legenda, não o áudio, e são ignorados.
export function categoryLang(name) {
  const p = prefixOf(name);
  if (p) return p.lang;
  const words = norm(name).split(' ');
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const c = BY_NAME.get(w) || COUNTRY.get(w);
    if (!c) continue;
    if (/^(sub|subs|subtitles?|subtitled|legendas?)$/.test(words[i + 1] || '')) continue;
    if (words[i - 1] === 'to' && words[i - 2] === 'translated') continue;
    return c;
  }
  // Códigos de região em maiúsculas no meio do nome ("Movies EX-YU", "VOD ARAB"); só com 3+ letras.
  for (const m of String(name || '').matchAll(/\b[A-Z]{2,5}(?:-[A-Z]{2,3})?\b/g)) {
    if (m[0].length >= 3 && REGION.get(m[0])) return REGION.get(m[0]);
  }
  return '';
}

// { lang, dn }: idioma do item e o nome sem o prefixo de região (dn só quando houver prefixo).
// Ordem: tvg-language, tvg-country, prefixo no nome, idioma da categoria.
export function detectLang({ name, group, tvgLanguage, tvgCountry, groupLang }) {
  const p = prefixOf(name);
  const dn = p && p.rest ? p.rest : '';
  if (tvgLanguage) {
    const l = langOf(String(tvgLanguage).split(/[,;]/)[0]);
    if (l) return { lang: l, dn };
  }
  if (tvgCountry) {
    const l = REGION.get(String(tvgCountry).split(/[,;]/)[0].trim().toUpperCase());
    if (l) return { lang: l, dn };
  }
  if (p && p.lang) return { lang: p.lang, dn };
  return { lang: groupLang !== undefined ? groupLang : categoryLang(group), dn };
}

// ---- Versões dubladas e legendadas ----
const VER_LONG = [
  ['dual', /\b(dual[\s-]?(audio|áudio)|multi[\s-]?audio)\b/i],
  ['dub', /\b(dublad[oa]s?|dubbed)\b/i],
  ['leg', /\b(legendad[oa]s?|subbed|vostfr|vose)\b/i],
];
const VER_SHORT = /[[(]\s*(dual|dub|leg|vo)\s*[\])]|\s-\s*(dual|dub|leg)\s*$/i;

// 'dub' | 'leg' | 'dual' | '' a partir do nome (primeiro) e da categoria.
export function detectVersion(name, group) {
  for (const s of [name, group]) {
    const t = String(s || '');
    const m = VER_SHORT.exec(t);
    if (m) { const v = (m[1] || m[2]).toLowerCase(); return v === 'vo' ? 'leg' : v; }
    for (const [v, re] of VER_LONG) if (re.test(t)) return v;
  }
  return '';
}

// Chave para reunir versões do mesmo título: sem prefixo de região e sem marcas de versão.
export function versionKey(name) {
  const p = prefixOf(name);
  const base = (p && p.rest ? p.rest : String(name || ''))
    .replace(new RegExp(VER_SHORT.source, 'gi'), ' ')
    .replace(/[[(]\s*(dublado|legendado|dual\s*[aá]udio|nacional)\s*[\])]/gi, ' ')
    .replace(/\s-\s*(dublado|legendado)\s*$/i, ' ');
  return norm(base);
}

export const VERSION_NAMES = { dub: 'Dublado', leg: 'Legendado', dual: 'Dual áudio' };
