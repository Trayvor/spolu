import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '@/components/language-switcher';
import { isAdmin } from '@/features/auth/roles';
import { UserMenu } from '@/features/auth/user-menu';
import { useSession } from '@/features/auth/use-session';

const navLink =
  'hidden h-[38px] items-center rounded-full px-4 text-tiny font-semibold transition-colors duration-(--duration-fast) hover:bg-accent min-[641px]:inline-flex';

/**
 * The egrant.sk header pill, kept still (no hide-on-scroll). On the left the brand
 * "Spolu by eGrant": the product name as the wordmark, a small "by" and the egrant logo,
 * one link to `/` named by `app.fullName`. On the right, for a signed-in user: the "Home", "Tasks", "Knowledge", "Groups" and "Admins" links (admins only, hidden under 641 px where
 * the user menu offers them), the user menu and the language menu.
 */
export function AppHeader() {
  const { t } = useTranslation();
  const user = useSession();
  return (
    <header className="mx-auto mt-3 flex h-[54px] w-full max-w-[1152px] items-center gap-3 rounded-nav bg-background px-4 shadow-lift min-[641px]:mt-6 min-[641px]:h-16 min-[641px]:px-6">
      <Link
        to="/"
        aria-label={t('app.fullName')}
        className="flex min-w-0 items-baseline gap-2 hover:text-foreground"
      >
        <span className="text-wordmark leading-none font-semibold tracking-[-0.4px]">
          {t('app.name')}
        </span>
        <span className="text-micro text-muted-foreground">by</span>
        <img
          src="/brand/egrant-logo.svg"
          alt=""
          width={212}
          height={40}
          className="h-[17px] w-auto min-[641px]:h-[22px]"
        />
      </Link>
      <div className="ml-auto flex items-center gap-2">
        {isAdmin(user) && (
          <>
            <Link to="/" activeOptions={{ exact: true }} className={navLink}>
              {t('nav.home')}
            </Link>
            <Link to="/tasks" className={navLink}>
              {t('nav.tasks')}
            </Link>
            <Link to="/knowledge" className={navLink}>
              {t('nav.knowledge')}
            </Link>
            <Link to="/groups" className={navLink}>
              {t('nav.groups')}
            </Link>
            <Link to="/admins" className={navLink}>
              {t('nav.admins')}
            </Link>
          </>
        )}
        {user && <UserMenu user={user} />}
        <LanguageSwitcher />
      </div>
    </header>
  );
}
