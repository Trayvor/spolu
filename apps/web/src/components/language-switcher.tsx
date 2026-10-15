import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { setLanguage } from '@/i18n';
import { isLanguage, LANGUAGES } from '@/i18n/detect';

// Styled like the egrant.sk header language toggle: a secondary pill showing the current code.
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" aria-label={t('language.label')}>
          {i18n.language.toUpperCase()}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={i18n.language}
          onValueChange={(value) => {
            if (isLanguage(value)) void setLanguage(value);
          }}
        >
          {LANGUAGES.map((lang) => (
            <DropdownMenuRadioItem key={lang} value={lang}>
              {t(`language.${lang}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
