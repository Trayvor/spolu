import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { buttonVariants } from '@/components/ui/button-variants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The Notifications card of /settings (UX review X7, 2026-10-18): one line on what the
 * notifications screen holds and the link to it; the settings themselves live on
 * `/settings/notifications`.
 */
export function NotificationsLinkCard() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('settings.notifications.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-4">
        <p className="text-button text-muted-foreground">{t('settings.notifications.summary')}</p>
        <Link
          to="/settings/notifications"
          className={buttonVariants({ variant: 'outline', size: 'lg' })}
        >
          {t('settings.notifications.open')}
        </Link>
      </CardContent>
    </Card>
  );
}
