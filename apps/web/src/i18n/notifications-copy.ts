import { i18n } from '@/i18n';
import en from '@/locales/notifications/en.json';
import sk from '@/locales/notifications/sk.json';
import type { Language } from './languages';

/**
 * The `notifications.*` texts (the bell and mode menu, the app prompt) ship with the lazy chunks
 * that render them, not with the entry chunk (see docs/architecture/performance.md, "Bundle
 * budget"). Every module that renders them imports this one first, so the texts are merged into
 * the `translation` namespace of every language before its components can render: no screen
 * shows raw keys. The Record type makes a missing language a type error.
 */
const bundles: Record<Language, typeof en> = { en, sk };

for (const [language, bundle] of Object.entries(bundles)) {
  i18n.addResourceBundle(language, 'translation', bundle, true, false);
}
