// Idiomas: nomes exibidos e reconhecimento a partir de códigos (pt, por, pt-BR) e nomes (Português, English).
import { norm } from './util.js';

export const LANGS = [
  { code: 'pt', name: 'Português', keys: ['pt', 'por', 'pob', 'ptb', 'portugues', 'portuguese', 'brazilian'] },
  { code: 'en', name: 'Inglês', keys: ['en', 'eng', 'english', 'ingles'] },
  { code: 'es', name: 'Espanhol', keys: ['es', 'spa', 'esp', 'spanish', 'espanol', 'castellano'] },
  { code: 'fr', name: 'Francês', keys: ['fr', 'fra', 'fre', 'french', 'francais', 'frances'] },
  { code: 'it', name: 'Italiano', keys: ['it', 'ita', 'italian', 'italiano'] },
  { code: 'de', name: 'Alemão', keys: ['de', 'deu', 'ger', 'german', 'deutsch', 'alemao'] },
];

const BY_KEY = new Map(LANGS.flatMap((l) => l.keys.map((k) => [k, l.code])));

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
