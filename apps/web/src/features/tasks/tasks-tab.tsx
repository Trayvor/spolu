import { Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

/** Placeholder until the task board arrives; the outlet is for the task panel route. */
export function TasksTab() {
  const { t } = useTranslation();
  return (
    <>
      <p className="py-10 text-center text-body text-muted-foreground">{t('tasks.placeholder')}</p>
      <Outlet />
    </>
  );
}
