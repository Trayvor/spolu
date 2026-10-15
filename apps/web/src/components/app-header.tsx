import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '@/components/language-switcher';

/**
 * The egrant.sk header pill, kept still (no hide-on-scroll): egrant logo plus the product
 * name where the website shows its tagline, and the language toggle on the right.
 */
export function AppHeader() {
  const { t } = useTranslation();
  return (
    <header className="mx-auto mt-3 flex h-[54px] w-full max-w-[1152px] items-center gap-3 rounded-nav bg-background px-4 shadow-lift min-[641px]:mt-6 min-[641px]:h-16 min-[641px]:px-6">
      <Link to="/" className="flex items-center gap-3 hover:text-foreground">
        <img
          src="/brand/egrant-logo.svg"
          alt="eGrant"
          width={212}
          height={40}
          className="h-6 w-auto min-[641px]:h-8"
        />
        <span className="text-medium font-semibold">{t('app.name')}</span>
      </Link>
      <div className="ml-auto">
        <LanguageSwitcher />
      </div>
    </header>
  );
}
