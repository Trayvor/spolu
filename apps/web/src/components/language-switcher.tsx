import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { deferredMenu } from '@/components/deferred-menu';
import { Toast } from '@/components/ui/toast';
import { useSession } from '@/features/auth/use-session';
import { saveLanguage } from '@/features/profile/language-api';
import { setLanguage } from '@/i18n';
import { isLanguage } from '@/i18n/detect';
import { SUPPORTED_LANGUAGES } from '@/i18n/languages';
import { pendingLanguage } from '@/i18n/namespaces';
// `clsx`, not `cn`: these classes never conflict, and `cn` would bring tailwind-merge into the
// initial JS.
import { clsx } from 'clsx';

/**
 * Switching the UI language, shared by the header's language menu and the phone account menu.
 * A switch first loads the new language's texts of the screens in use; only the latest choice
 * wins, so a choice is compared with the language being switched to, not the one shown. If the
 * texts cannot be loaded, the language stays and `failed` turns on (the caller shows the error
 * toast). For a signed-in user a choice that took effect is also stored on the server (emails and
 * pushes use it); that save is best effort.
 */
export function useLanguageChoice() {
  const signedIn = useSession() !== null;
  const [failed, setFailed] = useState(false);

  function choose(value: string) {
    if (!isLanguage(value) || value === pendingLanguage()) return;
    setFailed(false);
    setLanguage(value).then(
      (switched) => {
        if (switched && signedIn) saveLanguage(value).catch(() => undefined);
      },
      () => setFailed(true),
    );
  }

  return { choose, failed, dismiss: () => setFailed(false) };
}

/** The language menu's Radix part: a lazy chunk with the menu library (`deferredMenu`). */
const LanguageMenu = deferredMenu(() =>
  import('./language-menu').then((module) => module.LanguageMenu),
);

/**
 * The egrant.sk language selector: a `bg-secondary` pill showing the current code ("SK")
 * opens a menu below with every language in SUPPORTED_LANGUAGES, named in its own language,
 * the current one checked. The button's name includes the current language
 * (`language.current`, "Jazyk: Slovenčina"), so screen readers announce it.
 * For a signed-in user it is hidden under 641 px: the account menu offers the languages there,
 * so the phone header keeps room for the section menu.
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const signedIn = useSession() !== null;
  const current = SUPPORTED_LANGUAGES.find((lang) => lang.code === i18n.language);

  return (
    <LanguageMenu
      trigger={
        <button
          type="button"
          aria-label={t('language.current', { name: current?.name ?? i18n.language })}
          className={clsx(
            'relative inline-flex h-[38px] items-center gap-1 rounded-full bg-secondary pr-2.5 pl-3 text-tiny font-semibold text-secondary-foreground transition-colors duration-(--duration-fast) after:absolute after:-inset-[3px] hover:bg-surface-3 data-[state=open]:bg-surface-3',
            signedIn && 'max-[640px]:hidden',
          )}
        >
          {i18n.language.toUpperCase()}
          <ChevronDownIcon />
        </button>
      }
    />
  );
}

/** Shown when a language's texts could not be loaded. */
export function LanguageFailedToast({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return <Toast onClose={onClose}>{t('errors.generic')}</Toast>;
}

export function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
