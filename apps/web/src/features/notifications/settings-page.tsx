import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { isAdmin, isRequester } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { ClientTable } from './client-table';
import { NotificationsSection } from './notifications-section';

/**
 * `/settings/notifications` (UX review X7, 2026-10-18): every notification setting on one screen.
 * First how notifications arrive (the channel per notification group and this device), then what
 * arrives per client (the client table: mode and new tickets). The group bells and the bell in the
 * header link here. A requester-only person has no client to set, so only the channels show.
 */
export function NotificationSettingsPage() {
  const { t } = useTranslation();
  const user = useSession();
  const admin = isAdmin(user);
  const withClients = user !== null && (admin || !isRequester(user));
  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          to="/settings"
          className="self-start text-button font-medium text-muted-foreground hover:text-foreground"
        >
          {t('settings.notifications.back')}
        </Link>
        <h1 className="text-medium leading-tight font-semibold">
          {t('settings.notifications.title')}
        </h1>
      </div>
      <NotificationsSection title={t('settings.notifications.channelsTitle')} />
      {withClients && <ClientTable admin={admin} />}
    </div>
  );
}
