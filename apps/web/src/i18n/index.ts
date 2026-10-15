import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en.json';
import sk from '@/locales/sk.json';
import { detectInitialLanguage, type Language } from './detect';

export const LANGUAGE_STORAGE_KEY = 'ehub.lang';

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
  resources: { en: { translation: en }, sk: { translation: sk } },
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes
});

export const i18n = i18next;

export async function setLanguage(lang: Language) {
  await i18next.changeLanguage(lang);
  writeStored(lang);
  document.documentElement.lang = lang;
}
