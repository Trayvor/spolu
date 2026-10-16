import { afterEach, describe, expect, it } from 'vitest';
import cs from '@/locales/cs.json';
import uk from '@/locales/uk.json';
import { i18n, setLanguage } from './index';
import { EAGER_LANGUAGES, SUPPORTED_LANGUAGES } from './languages';
import { mainFiles, namespaceFiles } from './lazy-files';
import { isMainLocaleLoaded, loadMainLocale } from './main-locales';

describe('main locale files', () => {
  afterEach(async () => {
    await setLanguage('en');
  });

  it('only the eager languages are loaded at start', () => {
    for (const { code } of SUPPORTED_LANGUAGES) {
      if ((EAGER_LANGUAGES as readonly string[]).includes(code)) {
        expect(isMainLocaleLoaded(code)).toBe(true);
      }
    }
  });

  it('the lazy file maps hold exactly the languages that are not eager', () => {
    const lazy = SUPPORTED_LANGUAGES.map((l) => l.code)
      .filter((code) => !(EAGER_LANGUAGES as readonly string[]).includes(code))
      .sort();
    const codeOf = (path: string) => path.replace(/^.*\/(.+)\.json$/, '$1');
    expect(Object.keys(mainFiles).map(codeOf).sort()).toEqual(lazy);
    expect([...new Set(Object.keys(namespaceFiles).map(codeOf))].sort()).toEqual(lazy);
  });

  it('a lazy language loads its main file when chosen, then shows its texts', async () => {
    expect(await setLanguage('cs')).toBe(true);
    expect(isMainLocaleLoaded('cs')).toBe(true);
    expect(i18n.language).toBe('cs');
    expect(i18n.t('nav.home')).toBe(cs.nav.home);
    expect(document.documentElement.lang).toBe('cs');
  });

  it('every lazy language has a loadable main file', async () => {
    for (const { code } of SUPPORTED_LANGUAGES) await loadMainLocale(code);
    expect(i18n.t('nav.home', { lng: 'uk' })).toBe(uk.nav.home);
  });
});
