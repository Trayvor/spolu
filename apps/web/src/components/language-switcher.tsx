import { useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { setLanguage } from '@/i18n';
import { cn } from '@/lib/utils';
import { LANGUAGES, type Language } from '@/i18n/detect';

const ARROW_STEP: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * "SK | EN" toggle in the style of the egrant.sk language pill: a secondary pill holding
 * one button per language, the active one filled with ink.
 * It is an ARIA radio group: only the checked option is in the tab order and the arrow
 * keys move the choice. Each option shows its code but is named by the full language name.
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const buttons = useRef(new Map<Language, HTMLButtonElement>());

  function choose(lang: Language) {
    if (lang !== i18n.language) void setLanguage(lang);
    buttons.current.get(lang)?.focus();
  }

  function onKeyDown(event: KeyboardEvent, index: number) {
    const step = ARROW_STEP[event.key];
    if (step === undefined) return;
    event.preventDefault();
    choose(LANGUAGES[(index + step + LANGUAGES.length) % LANGUAGES.length] ?? LANGUAGES[0]);
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('language.label')}
      className="inline-flex gap-1 rounded-full bg-secondary p-1"
    >
      {LANGUAGES.map((lang, index) => {
        const checked = i18n.language === lang;
        return (
          <button
            key={lang}
            ref={(el) => {
              if (el) buttons.current.set(lang, el);
              else buttons.current.delete(lang);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={t(`language.${lang}`)}
            tabIndex={checked ? 0 : -1}
            onClick={() => choose(lang)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'h-[30px] min-w-[38px] rounded-full px-3 text-tiny font-semibold transition-colors duration-(--duration-fast)',
              checked
                ? 'bg-primary text-primary-foreground'
                : 'text-secondary-foreground hover:bg-surface-3',
            )}
          >
            {lang.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
