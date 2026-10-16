import { useTranslation } from 'react-i18next';
import type { DeferredMenuProps } from '@/components/deferred-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SUPPORTED_LANGUAGES } from '@/i18n/languages';
import { LanguageFailedToast, useLanguageChoice } from './language-switcher';

/**
 * The header language menu (lazy, see `LanguageSwitcher`): open on mount, as it mounts on the
 * first click of its trigger.
 */
export function LanguageMenu({ trigger }: DeferredMenuProps) {
  const { i18n } = useTranslation();
  const { choose, failed, dismiss } = useLanguageChoice();
  return (
    <>
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
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
      {failed && <LanguageFailedToast onClose={dismiss} />}
    </>
  );
}
