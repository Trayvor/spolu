import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en.json';
import sk from '@/locales/sk.json';
import { detectInitialLanguage } from './detect';
import { DEFAULT_LANGUAGE, type Language } from './languages';
import { changeLanguage } from './namespaces';

// The texts of the eager shell (header, menus, sign-in, errors). Feature texts are lazy
// namespaces in `src/locales/<name>/`, loaded by `./namespaces.ts` with their screens.
// One translation file per entry in SUPPORTED_LANGUAGES; the Record type makes a missing one a type error.
const resources: Record<Language, { translation: typeof en }> = {
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
  lng: initial,
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
