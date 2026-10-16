import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from '@tanstack/react-router';
import type { Me } from '@spolu/shared';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOut } from './api';
import { clientGroups, isAdmin, isRequester } from './roles';
import { clearSession } from './use-session';

/** First letters of the first two words of the name, upper-case ("Jana Nováková" gives "JN"). */
export function initials(name: string, email: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0]);
  return (letters.length > 0 ? letters.join('') : (Array.from(email)[0] ?? '')).toUpperCase();
}

/**
 * The account menu in the header: a 38 px `bg-secondary` circle with the user's initials,
 * the same size and colour as the language button. The menu shows who is signed in
 * (name and email, not clickable), then "Settings" (the profile and notification settings
 * page, for every role) and "Log out". Under 641 px the header has no room for
 * the "Home", "Tasks", "Tickets", "Knowledge", "Groups", "Admins" and "Bulk email" links, so admins get them here
 * instead (and a client who also reported tickets elsewhere gets "My tickets").
 */
export function UserMenu({ user }: { user: Me }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const router = useRouter();

  const logout = useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      clearSession(queryClient);
      await router.navigate({ to: '/login' });
    },
  });

  return (
    <div className="relative">
      <DropdownMenu onOpenChange={(open) => open && logout.reset()}>
        <DropdownMenuTrigger
          aria-label={t('user.menu')}
          className="inline-flex size-[38px] items-center justify-center rounded-full bg-secondary text-tiny font-semibold text-secondary-foreground transition-colors duration-(--duration-fast) hover:bg-surface-3 data-[state=open]:bg-surface-3"
        >
          {initials(user.name, user.email)}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-[min(320px,calc(100vw-24px))]">
          <DropdownMenuLabel className="flex flex-col gap-0.5 font-medium">
            <span className="truncate text-button font-semibold text-foreground">{user.name}</span>
            <span className="truncate">{user.email}</span>
          </DropdownMenuLabel>
          {isAdmin(user) && (
            <>
              <DropdownMenuItem asChild className="min-[641px]:hidden">
                <Link to="/">{t('nav.home')}</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="min-[641px]:hidden">
                <Link to="/tasks">{t('nav.tasks')}</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="min-[641px]:hidden">
                <Link to="/tickets">{t('nav.tickets')}</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="min-[641px]:hidden">
                <Link to="/knowledge">{t('nav.knowledge')}</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="min-[641px]:hidden">
                <Link to="/groups">{t('nav.groups')}</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="min-[641px]:hidden">
                <Link to="/admins">{t('nav.admins')}</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="min-[641px]:hidden">
                <Link to="/bulk-email">{t('nav.bulkEmail')}</Link>
              </DropdownMenuItem>
            </>
          )}
          {!isAdmin(user) && isRequester(user) && clientGroups(user).length > 0 && (
            <DropdownMenuItem asChild className="min-[641px]:hidden">
              <Link to="/tickets">{t('nav.myTickets')}</Link>
            </DropdownMenuItem>
          )}
          {!isAdmin(user) && clientGroups(user).length > 1 && (
            <DropdownMenuItem asChild className="min-[641px]:hidden">
              <Link to="/my-groups">{t('nav.myGroups')}</Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/settings">{t('nav.settings')}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => logout.mutate()}>{t('user.logout')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {logout.isError && (
        <p
          role="alert"
          className="absolute top-full right-0 z-10 mt-2 w-max max-w-[240px] rounded-lg bg-card p-3 text-micro text-error-ink shadow-lift"
        >
          {t('errors.generic')}
        </p>
      )}
    </div>
  );
}
