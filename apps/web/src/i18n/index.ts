import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en.json';
import sk from '@/locales/sk.json';
import { detectInitialLanguage } from './detect';
import { DEFAULT_LANGUAGE, EAGER_LANGUAGES, type Language } from './languages';
import { isMainLocaleLoaded } from './main-locales';
import { changeLanguage } from './namespaces';

// The texts of the eager shell (header, menus, sign-in, errors) in the eager languages. The
// other languages' main files load on use (`./main-locales.ts`); feature texts are lazy
// namespaces in `src/locales/<name>/`, loaded by `./namespaces.ts` with their screens.
// The Record type makes a missing eager file a type error.
const resources: Record<(typeof EAGER_LANGUAGES)[number], { translation: typeof en }> = {
  sk: { translation: sk },
  en: { translation: en },
};

export const LANGUAGE_STORAGE_KEY = 'spolu.lang';

// Storage can throw (private mode, blocked site data), so every access is guarded.
function readStored(): string | null {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(lang: Language) {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // Not persisted; the choice still applies for this session.
  }
}

const initial = detectInitialLanguage(readStored(), navigator.languages);
document.documentElement.lang = initial;

void i18next.use(initReactI18next).init({
  resources,
  // A lazy language starts in the default and switches once its texts are in (`i18nReady`).
  lng: isMainLocaleLoaded(initial) ? initial : DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false }, // React already escapes
});

export const i18n = i18next;

/**
 * Switches once the lazy namespaces loaded so far are there in `lang` too (no raw keys), then
 * stores the choice. `false`: a later choice superseded this one (nothing changed). Rejects,
 * keeping the language, when a namespace cannot be loaded.
 */
export async function setLanguage(lang: Language): Promise<boolean> {
  if (!(await changeLanguage(lang))) return false;
  writeStored(lang);
  document.documentElement.lang = lang;
  return true;
}

/**
 * Settles once the first language is shown: at once for an eager one, after its main file for
 * a lazy one (`main.tsx` renders after it, so no text flashes in English). A failed load
 * (offline) keeps the default language.
 */
export const i18nReady: Promise<void> = isMainLocaleLoaded(initial)
  ? Promise.resolve()
  : changeLanguage(initial).then(
      () => undefined,
      () => {
        document.documentElement.lang = i18next.language;
      },
    );
