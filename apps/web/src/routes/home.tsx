import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/use-session';
import { StatusCard } from '@/features/system/status-card';

export function HomePage() {
  const { t } = useTranslation();
  const user = useSession();
  return (
    <div className="flex max-w-[552px] flex-col gap-6">
      {user && (
        <h1 className="text-medium leading-tight font-semibold">
          {t('home.welcome', { name: user.name })}
        </h1>
      )}
      <StatusCard />
    </div>
  );
}
