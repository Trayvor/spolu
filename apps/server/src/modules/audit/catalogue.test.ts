import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUDIT_CATALOGUE, AUDIT_ENTITY_TYPES, AUDIT_FIELDS } from '@spolu/shared';

/** The web's `audit` namespace in all nine languages (spec §11). */
const LANGS = ['sk', 'en', 'cs', 'sl', 'bg', 'et', 'it', 'hr', 'uk'];
const locale = (lang: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../../../web/src/locales/audit/${lang}.json`, import.meta.url)),
      'utf8',
    ),
  ) as {
    actions: Record<string, Record<string, string>>;
    fields: Record<string, Record<string, string>>;
    types: Record<string, string>;
  };

describe('the audit catalogue and its texts', () => {
  for (const lang of LANGS) {
    it(`every (entity type, action) has audit.actions.<type>.<action> in ${lang}, with the label`, () => {
      const texts = locale(lang);
      for (const type of AUDIT_ENTITY_TYPES) {
        expect(texts.types[type], `${lang} types.${type}`).toBeTruthy();
        for (const action of AUDIT_CATALOGUE[type].actions) {
          const text = texts.actions[type]?.[action];
          expect(text, `${lang} actions.${type}.${action}`).toBeTruthy();
          expect(text).toContain('{{label}}');
        }
      }
    });

    it(`every field of AUDIT_FIELDS has audit.fields.<type>.<field> in ${lang}`, () => {
      const texts = locale(lang);
      for (const type of AUDIT_ENTITY_TYPES) {
        for (const field of Object.keys(AUDIT_FIELDS[type])) {
          expect(texts.fields[type]?.[field], `${lang} fields.${type}.${field}`).toBeTruthy();
        }
      }
    });
  }
});
