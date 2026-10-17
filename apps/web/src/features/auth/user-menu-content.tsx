import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from '@tanstack/react-router';
import type { Me } from '@spolu/shared';
import { useTranslation } from 'react-i18next';
import type { DeferredMenuProps } from '@/components/deferred-menu';
import { LanguageFailedToast, useLanguageChoice } from '@/components/language-switcher';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SUPPORTED_LANGUAGES } from '@/i18n/languages';
import { signOut } from './api';
import { clearSession } from './use-session';

/**
 * The account menu (lazy, see `UserMenu`): open on mount, as it mounts on the first click of its
 * trigger. Name and email, Settings, the languages (phones only, two columns of their own names)
 * and Log out. A failed Log out shows a generic error under the button.
 */
export function AccountMenu({ user, trigger }: { user: Me } & DeferredMenuProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const router = useRouter();
  const language = useLanguageChoice();
  const current = SUPPORTED_LANGUAGES.find((lang) => lang.code === i18n.language);

  const logout = useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      clearSession(queryClient);
      // In place of the page signed out from (it would only send Back to the login again).
      await router.navigate({ to: '/login', replace: true });
    },
  });

  return (
    <div className="relative">
      <DropdownMenu defaultOpen onOpenChange={(open) => open && logout.reset()}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[min(320px,calc(100vw-24px))]">
          <DropdownMenuLabel className="flex flex-col gap-0.5 font-medium">
            <span className="truncate text-button font-semibold text-foreground">{user.name}</span>
            <span className="truncate">{user.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/settings">{t('nav.settings')}</Link>
          </DropdownMenuItem>
          <div className="min-[641px]:hidden">
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              {t('language.current', { name: current?.name ?? i18n.language })}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={i18n.language}
              onValueChange={language.choose}
              className="grid grid-cols-2 gap-0.5"
            >
              {SUPPORTED_LANGUAGES.map(({ code, name }) => (
                <DropdownMenuRadioItem key={code} value={code} lang={code} className="min-w-0">
                  <span className="block truncate">{name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => logout.mutate()}>{t('user.logout')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {logout.isError && (
        <p
          role="alert"
          className="absolute top-full right-0 z-10 mt-2 w-max max-w-[240px] animate-fade-in rounded-lg bg-card p-3 text-micro text-error-ink shadow-lift"
        >
          {t('errors.generic')}
        </p>
      )}
      {language.failed && <LanguageFailedToast onClose={language.dismiss} />}
    </div>
  );
}
