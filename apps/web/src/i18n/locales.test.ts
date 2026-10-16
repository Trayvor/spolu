import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from './languages';

const files = import.meta.glob<Record<string, unknown>>('../locales/*.json', {
  eager: true,
  import: 'default',
});
const locales = Object.fromEntries(
  Object.entries(files).map(([path, json]) => [path.replace(/^.*\/(.+)\.json$/, '$1'), json]),
);

// Copy that ships with lazy chunks, not with the entry chunk: `src/locales/<bundle>/<code>.json`,
// merged by `src/i18n/<bundle>-copy.ts` (settings page; bell, mode menu and app prompt).
const LAZY_BUNDLES = ['settings', 'notifications'] as const;
const lazyFiles = import.meta.glob<Record<string, unknown>>('../locales/*/*.json', {
  eager: true,
  import: 'default',
});
const lazyLocales = (bundle: string) =>
  Object.fromEntries(
    Object.entries(lazyFiles)
      .filter(([path]) => path.startsWith(`../locales/${bundle}/`))
      .map(([path, json]) => [path.replace(/^.*\/(.+)\.json$/, '$1'), json]),
  );

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

/** Plural forms differ per language (en has one/other, sk adds few/many): compare the base key. */
const baseKeys = (obj: Record<string, unknown>) => [
  ...new Set(flatten(obj).map((key) => key.replace(/_(zero|one|two|few|many|other)$/, ''))),
];

describe('locales', () => {
  it('there is exactly one locale file per supported language', () => {
    expect(Object.keys(locales).sort()).toEqual(SUPPORTED_LANGUAGES.map((l) => l.code).sort());
  });

  it('every locale has the same keys as en.json', () => {
    const enKeys = baseKeys(locales.en ?? {}).sort();
    for (const [code, json] of Object.entries(locales)) {
      expect({ code, keys: baseKeys(json).sort() }).toEqual({ code, keys: enKeys });
    }
  });

  it('the lazy bundles are exactly settings and notifications', () => {
    const found = new Set(Object.keys(lazyFiles).map((path) => path.split('/')[2]));
    expect([...found].sort()).toEqual([...LAZY_BUNDLES].sort());
  });

  for (const bundle of LAZY_BUNDLES) {
    it(`the lazy ${bundle} bundle has one file per language, all with the same keys`, () => {
      const bundleLocales = lazyLocales(bundle);
      const codes = Object.keys(bundleLocales).sort();
      expect(codes).toEqual(SUPPORTED_LANGUAGES.map((l) => l.code).sort());
      const enKeys = baseKeys(bundleLocales.en ?? {}).sort();
      for (const [code, json] of Object.entries(bundleLocales)) {
        expect({ code, keys: baseKeys(json).sort() }).toEqual({ code, keys: enKeys });
      }
    });

    it(`the ${bundle} bundle adds keys and never overrides one of the main files`, () => {
      const main = new Set(flatten(locales.en ?? {}));
      expect(flatten(lazyLocales(bundle).en ?? {}).filter((key) => main.has(key))).toEqual([]);
    });
  }

  it('the notifications texts are not in the main files (they ship with the lazy chunks)', () => {
    for (const [code, json] of Object.entries(locales)) {
      expect({ code, has: 'notifications' in json }).toEqual({ code, has: false });
    }
  });

  it('every plural key has an _other form in every locale', () => {
    const pluralSuffix = /_(zero|one|two|few|many|other)$/;
    for (const [code, json] of Object.entries(locales)) {
      const keys = new Set(flatten(json));
      const pluralBases = [...keys]
        .filter((key) => pluralSuffix.test(key))
        .map((key) => key.replace(pluralSuffix, ''));
      const missing = [...new Set(pluralBases)].filter((base) => !keys.has(`${base}_other`));
      expect({ code, missing }).toEqual({ code, missing: [] });
    }
  });
});
