import { useTranslation } from 'react-i18next';
import { StatusCard } from '@/features/system/status-card';

// The profile settings arrive later; for now the page also holds the system status.
export function SettingsPage() {
  const { t } = useTranslation();
  return (
    <div className="flex max-w-[552px] flex-col gap-6">
      <h1 className="text-medium leading-tight font-semibold">{t('nav.settings')}</h1>
      <StatusCard />
    </div>
  );
}
