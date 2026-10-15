import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from './languages';

const files = import.meta.glob<Record<string, unknown>>('../locales/*.json', {
  eager: true,
  import: 'default',
});
const locales = Object.fromEntries(
  Object.entries(files).map(([path, json]) => [path.replace(/^.*\/(.+)\.json$/, '$1'), json]),
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
});
