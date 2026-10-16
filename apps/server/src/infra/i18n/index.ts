import type { UserLanguage } from '@spolu/shared';
import { bg } from './bg.js';
import { cs } from './cs.js';
import { en } from './en.js';
import { et } from './et.js';
import { hr } from './hr.js';
import { it } from './it.js';
import { sk } from './sk.js';
import { sl } from './sl.js';
import { uk } from './uk.js';
import type { ServerTexts } from './types.js';

export type { ServerTexts } from './types.js';
export { plural } from './plural.js';

/**
 * The server's texts by language. The Record type makes a language of `UserLanguages` without
 * its file a type error; adding one = add `<code>.ts` here (and its web locale files).
 */
const TEXTS: Record<UserLanguage, ServerTexts> = { sk, en, cs, sl, bg, et, it, hr, uk };

/** The texts in `lang`. A stored language is always one of `UserLanguages` (a database check). */
export function serverTexts(lang: UserLanguage): ServerTexts {
  return TEXTS[lang] ?? TEXTS.sk;
}
