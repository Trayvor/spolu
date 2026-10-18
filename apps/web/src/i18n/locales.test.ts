import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from './languages';

const codeOf = (path: string) => path.replace(/^.*\/(.+)\.json$/, '$1');

// Read as text: the imported JSON objects are the live i18next store, which namespaces extend.
const parsed = (raw: Record<string, string>) =>
  Object.entries(raw).map(
    ([path, text]) => [path, JSON.parse(text) as Record<string, unknown>] as const,
  );

/** The main locale files, bundled with the entry chunk: `src/locales/<code>.json`. */
const files = parsed(
  import.meta.glob<string>('../locales/*.json', { eager: true, query: '?raw', import: 'default' }),
);
const locales = Object.fromEntries(files.map(([path, json]) => [codeOf(path), json]));

/**
 * Lazy namespaces: `src/locales/<name>/<code>.json`, loaded by `loadNamespace(name)` with the
 * chunks that render them and merged under the key `<name>` (see `src/i18n/namespaces.ts`).
 */
const NAMESPACES = [
  'adminHome',
  'admins',
  'bottomNav',
  'bulkEmail',
  'calendarFeed',
  'chat',
  'finance',
  'financeDocuments',
  'financeLog',
  'financeSystem',
  'financeOrg',
  'forms',
  'group',
  'groups',
  'join',
  'knowledge',
  'login',
  'mcp',
  'notificationCentre',
  'notifications',
  'openInClaude',
  'passkeys',
  'projects',
  'reminders',
  'savedViews',
  'search',
  'settings',
  'snippets',
  'system',
  'taskSplit',
  'tasks',
  'teams',
  'tickets',
  'unseen',
  'unsubscribe',
  'welcome',
] as const;
const namespaceFiles = parsed(
  import.meta.glob<string>('../locales/*/*.json', {
    eager: true,
    query: '?raw',
    import: 'default',
  }),
);
const namespaceLocales = (name: string) =>
  Object.fromEntries(
    namespaceFiles
      .filter(([path]) => path.startsWith(`../locales/${name}/`))
      .map(([path, json]) => [codeOf(path), json]),
  );

/** Every locale as i18next sees it once all namespaces are loaded, per language code. */
const merged = Object.fromEntries(
  SUPPORTED_LANGUAGES.map(({ code }) => [
    code,
    {
      ...locales[code],
      ...Object.fromEntries(NAMESPACES.map((name) => [name, namespaceLocales(name)[code] ?? {}])),
    },
  ]),
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

const codes = SUPPORTED_LANGUAGES.map((l) => l.code).sort();

describe('locales', () => {
  it('there is exactly one main locale file per supported language', () => {
    expect(Object.keys(locales).sort()).toEqual(codes);
  });

  it('every main locale file has the same keys as en.json', () => {
    const enKeys = baseKeys(locales.en ?? {}).sort();
    for (const [code, json] of Object.entries(locales)) {
      expect({ code, keys: baseKeys(json).sort() }).toEqual({ code, keys: enKeys });
    }
  });

  it('the namespace folders are exactly the listed namespaces', () => {
    const found = new Set(namespaceFiles.map(([path]) => path.split('/')[2]));
    expect([...found].sort()).toEqual([...NAMESPACES].sort());
  });

  for (const name of NAMESPACES) {
    it(`the ${name} namespace has one file per language, all with the same keys`, () => {
      const byCode = namespaceLocales(name);
      expect(Object.keys(byCode).sort()).toEqual(codes);
      const enKeys = baseKeys(byCode.en ?? {}).sort();
      expect(enKeys.length).toBeGreaterThan(0);
      for (const [code, json] of Object.entries(byCode)) {
        expect({ code, keys: baseKeys(json).sort() }).toEqual({ code, keys: enKeys });
      }
    });

    it(`the ${name} namespace is not also in the main files (it ships with lazy chunks)`, () => {
      for (const [code, json] of Object.entries(locales)) {
        expect({ code, has: name in json }).toEqual({ code, has: false });
      }
    });

    it(`the ${name} namespace file holds its keys without a "${name}" wrapper`, () => {
      // `loadNamespace` adds the wrapper; a file that has it too would give `name.name.*` keys.
      expect(Object.keys(namespaceLocales(name).en ?? {})).not.toContain(name);
    });
  }

  it('the eager shell keeps its texts in the main files', () => {
    for (const key of ['app', 'nav', 'user', 'language', 'errors', 'notFound']) {
      expect({ key, eager: key in (locales.en ?? {}) }).toEqual({ key, eager: true });
    }
  });

  it('every plural key has an _other form in every locale, namespaces included', () => {
    const pluralSuffix = /_(zero|one|two|few|many|other)$/;
    for (const [code, json] of Object.entries(merged)) {
      const keys = new Set(flatten(json));
      const pluralBases = [...keys]
        .filter((key) => pluralSuffix.test(key))
        .map((key) => key.replace(pluralSuffix, ''));
      const missing = [...new Set(pluralBases)].filter((base) => !keys.has(`${base}_other`));
      expect({ code, missing }).toEqual({ code, missing: [] });
    }
  });

  it('every plural key has every plural form its language uses (Intl.PluralRules)', () => {
    const pluralSuffix = /_(zero|one|two|few|many|other)$/;
    for (const [code, json] of Object.entries(merged)) {
      const categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
      const keys = new Set(flatten(json));
      const bases = new Set(
        [...keys].filter((key) => pluralSuffix.test(key)).map((k) => k.replace(pluralSuffix, '')),
      );
      const missing = [...bases].flatMap((base) =>
        categories.filter((c) => !keys.has(`${base}_${c}`)).map((c) => `${base}_${c}`),
      );
      expect({ code, missing }).toEqual({ code, missing: [] });
    }
  });

  it('every language beyond sk and en has its own texts, not a copy of en', () => {
    const en = flatten(locales.en ?? {});
    for (const { code } of SUPPORTED_LANGUAGES) {
      if (code === 'en') continue;
      const json = locales[code] ?? {};
      const same = en.filter((key) => {
        const read = (obj: Record<string, unknown>) =>
          key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
        return read(json) === read(locales.en ?? {});
      });
      // Brand names and a few symbols may match; most texts must not.
      expect({ code, copied: same.length < en.length / 4 }).toEqual({ code, copied: true });
    }
  });

  /** Every text of a language, namespaces included, as `key: text`. */
  const textsOf = (code: string) => {
    const json = merged[code] ?? {};
    return flatten(json).map((key) => {
      const text = key
        .split('.')
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], json);
      return `${key}: ${String(text)}`;
    });
  };

  it('it addresses the reader formally (Lei, ADR 0019): no tu forms', () => {
    const informal = /\b(sei|ti|tuo|tua|tuoi|tue|puoi|vuoi|hai|riconnetti)\b/i;
    const value = (line: string) => line.slice(line.indexOf(': ') + 2);
    expect(textsOf('it').filter((line) => informal.test(value(line)))).toEqual([]);
  });

  it('sl asks the reader, not itself: no question opening with a first-person verb', () => {
    const firstPerson = /^[A-ZČŠŽ][a-zčšž]+(im|em|am) [^?]*\?$/;
    const value = (line: string) => line.slice(line.indexOf(': ') + 2);
    expect(textsOf('sl').filter((line) => firstPerson.test(value(line)))).toEqual([]);
  });

  it('the namespaces have plural keys to check (the plural test sees them)', () => {
    const plural = flatten(merged.en ?? {}).filter((key) => key.endsWith('_other'));
    expect(plural.some((key) => key.startsWith('chat.'))).toBe(true);
    expect(plural.some((key) => key.startsWith('tasks.'))).toBe(true);
  });
});
