import { useTranslation } from 'react-i18next';

/** The global task board (Task 10 fills it). */
export function GlobalBoardPage() {
  const { t } = useTranslation();
  return <h1 className="text-medium font-semibold">{t('nav.tasks')}</h1>;
}
