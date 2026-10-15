import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { setLanguage } from '@/i18n';
import { isLanguage } from '@/i18n/detect';
import { SUPPORTED_LANGUAGES } from '@/i18n/languages';

/**
 * The egrant.sk language selector: a `bg-secondary` pill showing the current code ("SK")
 * opens a menu below with every language in SUPPORTED_LANGUAGES, named in its own language,
 * the current one checked. The button's name includes the current language
 * (`language.current`, "Jazyk: Slovenčina"), so screen readers announce it.
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  const current = SUPPORTED_LANGUAGES.find((lang) => lang.code === i18n.language);

  function choose(value: string) {
    if (isLanguage(value) && value !== i18n.language) void setLanguage(value);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('language.current', { name: current?.name ?? i18n.language })}
        className="inline-flex h-[38px] items-center gap-1 rounded-full bg-secondary pr-2.5 pl-3 text-tiny font-semibold text-secondary-foreground transition-colors duration-(--duration-fast) hover:bg-surface-3 data-[state=open]:bg-surface-3"
      >
        {i18n.language.toUpperCase()}
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={i18n.language} onValueChange={choose}>
          {SUPPORTED_LANGUAGES.map(({ code, name }) => (
            <DropdownMenuRadioItem key={code} value={code} lang={code}>
              {name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
