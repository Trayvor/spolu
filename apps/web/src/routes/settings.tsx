import { useTranslation } from 'react-i18next';
import { NotificationsSection } from '@/features/notifications/notifications-section';
import { ProfileSection } from '@/features/profile/profile-section';
import { StatusCard } from '@/features/system/status-card';

/** /settings: the Profile, Notifications and System status cards, in that order. */
export function SettingsPage() {
  const { t } = useTranslation();
  return (
    <div className="flex max-w-[552px] flex-col gap-6">
      <h1 className="text-medium leading-tight font-semibold">{t('nav.settings')}</h1>
      <ProfileSection />
      <NotificationsSection />
      <StatusCard />
    </div>
  );
}
