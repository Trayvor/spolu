import { useTranslation } from 'react-i18next';

// Placeholder: the real settings screen arrives with the auth and profile work.
export function SettingsPage() {
  const { t } = useTranslation();
  return <h1 className="text-medium font-semibold">{t('nav.settings')}</h1>;
}
