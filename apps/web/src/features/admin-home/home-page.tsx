import { useTranslation } from 'react-i18next';

/** The admin dashboard (Task 9 fills it). */
export function HomePage() {
  const { t } = useTranslation();
  return <h1 className="text-medium font-semibold">{t('nav.home')}</h1>;
}
