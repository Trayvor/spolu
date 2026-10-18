import { normalizeSearch } from '../../infra/text/search.js';

// "Navrhnúť odpoveď" (2026-10-19): the retrieval terms of a ticket, and the masking of another
// client's identity in what reaches the AI. Pure helpers. See
// docs/superpowers/specs/2026-10-19-ticket-ai-draft-design.md §5.

/** The most terms one draft searches with. */
export const DRAFT_TERMS_MAX = 8;
const MIN_WORD = 4;
/** A crude stem for Slovak inflection: "rozpočtu" and "rozpočet" both become "rozpoc". */
const STEM = 6;

/** Common sk/cs/en words of 4+ letters (normalized), checked before the cut. */
const STOP_WORDS = new Set([
  // sk
  'alebo',
  'ktory',
  'ktora',
  'ktore',
  'ktori',
  'preto',
  'pretoze',
  'dobry',
  'dobre',
  'dakujem',
  'dakujeme',
  'prosim',
  'prosime',
  'mame',
  'mate',
  'bude',
  'budem',
  'budeme',
  'bolo',
  'bola',
  'boli',
  'tento',
  'tato',
  'toto',
  'tieto',
  'tomto',
  'tejto',
  'kedy',
  'este',
  'teda',
  'takze',
  'vsak',
  'vsetky',
  'vsetko',
  'potrebujem',
  'potrebujeme',
  'chcem',
  'chceme',
  'mohli',
  'mohla',
  'mohol',
  'mozem',
  'mozeme',
  'pozdravom',
  'zdravim',
  'otazka',
  'ohladom',
  'nasej',
  'nasho',
  'vasej',
  'vaseho',
  'pani',
  // cs
  'nebo',
  'ktery',
  'ktera',
  'ktere',
  'protoze',
  'dekuji',
  'muzete',
  'jsme',
  'jsou',
  'bylo',
  'byla',
  'jeste',
  'tady',
  'take',
  // en
  'this',
  'that',
  'with',
  'have',
  'from',
  'there',
  'they',
  'what',
  'when',
  'which',
  'would',
  'could',
  'should',
  'please',
  'thanks',
  'thank',
  'hello',
  'regards',
  'about',
]);

/**
 * The retrieval terms of a ticket's texts (subject, body, the requester's newest message): words
 * of 4+ characters that are not stop words, normalized and cut to 6 characters, the most frequent
 * first (then the longer word, then the first seen), at most 8.
 */
export function draftTerms(texts: string[]): string[] {
  const stems = new Map<string, { count: number; length: number; order: number }>();
  for (const text of texts) {
    for (const word of normalizeSearch(text).split(/[^\p{L}\p{N}]+/u)) {
      if (word.length < MIN_WORD || STOP_WORDS.has(word)) continue;
      const stem = word.slice(0, STEM);
      const seen = stems.get(stem);
      if (seen) {
        seen.count++;
        seen.length = Math.max(seen.length, word.length);
      } else {
        stems.set(stem, { count: 1, length: word.length, order: stems.size });
      }
    }
  }
  return [...stems.entries()]
    .sort(([, a], [, b]) => b.count - a.count || b.length - a.length || a.order - b.order)
    .slice(0, DRAFT_TERMS_MAX)
    .map(([stem]) => stem);
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
const PHONE = /\+?\d[\d /-]{5,}\d/g;

/** Every email becomes `[e-mail]`, every phone number (7+ digits) `[telefón]`. */
export function redactContacts(text: string): string {
  return text
    .replace(EMAIL, '[e-mail]')
    .replace(PHONE, (match) => (match.replace(/\D/g, '').length >= 7 ? '[telefón]' : match));
}

/** The identities of another client: people's names and the client's names. */
export type Identities = { names: string[]; clients: string[] };

/** Generic words a client's name starts or ends with ("Obec Horná Lehota" is "Horná Lehota"). */
const GENERIC_PREFIXES = [
  'obec',
  'mesto',
  'mestska cast',
  'obcianske zdruzenie',
  'zdruzenie',
  'nadacia',
  'spolok',
  'zakladna skola',
  'stredna skola',
  'skola',
  'obcina',
  'mestna obcina',
  'opcina',
  'grad',
  'comune di',
  'comune',
];
const GENERIC_SUFFIXES = [
  's.r.o.',
  'sro',
  'a.s.',
  'o.z.',
  'n.o.',
  'd.o.o.',
  'spol. s r.o.',
  'z.s.',
];

/** One character folded the way `normalizeSearch` folds it (diacritics off, lower case). */
const foldChar = (c: string) => c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A folded phrase as a pattern: its words with any whitespace between them. */
const phrasePattern = (phrase: string) =>
  phrase.split(' ').filter(Boolean).map(escapeRegExp).join('\\s+');

/**
 * Replaces every match of the folded `phrases` in `text` (compared folded, so case and
 * diacritics never matter) with `token`. Whole words only; with `prefix` a word that starts with
 * the phrase (an inflected "Novákom") is replaced whole. Never inside a `[token]`.
 */
function replacePhrases(text: string, phrases: string[], token: string, prefix: boolean): string {
  let out = text;
  for (const phrase of [...new Set(phrases)].sort((a, b) => b.length - a.length)) {
    if (phrase === '') continue;
    // The folded text, and for each folded position the original one.
    let folded = '';
    const origin: number[] = [];
    let index = 0;
    for (const c of out) {
      const f = foldChar(c);
      for (let k = 0; k < f.length; k++) origin.push(index);
      folded += f;
      index += c.length;
    }
    origin.push(index);
    const tail = prefix ? '[\\p{L}\\p{N}]*' : '';
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}\\[])${phrasePattern(phrase)}${tail}(?![\\p{L}\\p{N}\\]])`,
      'gu',
    );
    const ranges: [number, number][] = [];
    for (const m of folded.matchAll(re)) {
      ranges.push([origin[m.index]!, origin[m.index + m[0].length]!]);
    }
    for (const [start, end] of ranges.reverse()) {
      out = out.slice(0, start) + token + out.slice(end);
    }
  }
  return out;
}

/** A client's name and its form without a generic word, folded. */
function clientPhrases(name: string): string[] {
  const folded = normalizeSearch(name);
  const forms = [folded];
  let core = folded;
  for (const p of GENERIC_PREFIXES) {
    if (core.startsWith(`${p} `)) core = core.slice(p.length + 1).trim();
  }
  for (const s of GENERIC_SUFFIXES) {
    if (core.endsWith(` ${s}`))
      core = core
        .slice(0, -s.length - 1)
        .replace(/,$/, '')
        .trim();
  }
  if (core !== folded && core.replace(/[^\p{L}]/gu, '').length >= 3) forms.push(core);
  return forms;
}

/** A person's name parts of 3+ letters; a name of short parts only is matched whole. */
function namePhrases(name: string): string[] {
  const folded = normalizeSearch(name);
  const parts = folded.split(/[^\p{L}\p{N}]+/u).filter((p) => p.length >= 3);
  return parts.length > 0 ? parts : folded === '' ? [] : [folded];
}

/**
 * Another client's identity out of a text that goes to the AI: the client's names become
 * `[klient]`, people's names and their parts of 3+ letters `[meno]` (whole words, case and
 * diacritics ignored). Run `redactContacts` after it.
 */
export function maskIdentities(text: string, identities: Identities): string {
  const clients = identities.clients.flatMap(clientPhrases);
  const names = identities.names.flatMap(namePhrases);
  return replacePhrases(replacePhrases(text, clients, '[klient]', false), names, '[meno]', false);
}

/**
 * The last guard on a reply (`sanitizeDraft`): any of these identities that still appears, also
 * inflected ("Novákom"), becomes `[…]`.
 */
export function guardIdentities(text: string, identities: Identities): string {
  const phrases = [
    ...identities.clients.flatMap(clientPhrases),
    ...identities.names.flatMap(namePhrases),
  ];
  return replacePhrases(text, phrases, '[…]', true);
}
