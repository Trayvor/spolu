import { Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

/** Placeholder until the chat arrives. */
export function ChatTab() {
  const { t } = useTranslation();
  return (
    <>
      <p className="py-10 text-center text-body text-muted-foreground">{t('chat.placeholder')}</p>
      <Outlet />
    </>
  );
}
