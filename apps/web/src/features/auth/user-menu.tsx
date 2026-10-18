import type { Me } from '@spolu/shared';
import { useTranslation } from 'react-i18next';
import { deferredMenu } from '@/components/deferred-menu';

/** First letters of the first two words of the name, upper-case ("Jana Nováková" gives "JN"). */
function initials(name: string, email: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0]);
  return (letters.length > 0 ? letters.join('') : (Array.from(email)[0] ?? '')).toUpperCase();
}

/** The account menu's Radix part: a lazy chunk with the menu library (`deferredMenu`). */
const AccountMenu = deferredMenu<{ user: Me }>(() =>
  import('./user-menu-content').then((module) => module.AccountMenu),
);

/**
 * The account menu in the header: a 38 px `bg-secondary` circle with the user's initials,
 * the same size and colour as the language button (its tap area is 44 px). The menu holds
 * only the person's own things: who is signed in (name and email, not clickable), "Settings"
 * (the profile and notification settings page, for every role), under 641 px the language
 * choice (the header has no room for the language pill there), and "Log out". Moving between
 * the app's sections is the section menu's job (`SectionMenu`), not this one's.
 */
export function UserMenu({ user }: { user: Me }) {
  const { t } = useTranslation();
  return (
    <AccountMenu
      user={user}
      trigger={
        <button
          type="button"
          aria-label={t('user.menu')}
          className="relative inline-flex size-[38px] shrink-0 items-center justify-center rounded-full bg-secondary text-tiny font-semibold text-secondary-foreground transition-colors duration-(--duration-fast) after:absolute after:-inset-[3px] after:rounded-full hover:bg-surface-3 data-[state=open]:bg-surface-3"
        >
          {initials(user.name, user.email)}
        </button>
      }
    />
  );
}
