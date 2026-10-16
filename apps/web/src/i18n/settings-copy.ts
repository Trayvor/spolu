import { i18n } from '@/i18n';
import en from '@/locales/settings/en.json';
import sk from '@/locales/settings/sk.json';
import type { Language } from './languages';

/**
 * The `settings.profile.*` and `settings.notifications.*` texts ship with the lazy settings page,
 * not with the entry chunk (see docs/architecture/performance.md, "Bundle budget"). Importing
 * this module merges them into the `translation` namespace of every language, before the
 * page renders. The Record type makes a missing language a type error.
 */
const bundles: Record<Language, typeof en> = { en, sk };

for (const [language, bundle] of Object.entries(bundles)) {
  i18n.addResourceBundle(language, 'translation', bundle, true, false);
}
