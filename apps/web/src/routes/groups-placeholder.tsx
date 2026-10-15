import { useTranslation } from 'react-i18next';

// Placeholder: the group page replaces this in the next task.
export function GroupPage() {
  const { t } = useTranslation();
  return <h1 className="text-medium font-semibold">{t('groups.title')}</h1>;
}
