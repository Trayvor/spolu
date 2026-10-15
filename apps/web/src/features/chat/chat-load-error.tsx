import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

/** "The chat could not be loaded." with "Try again", centred in the chat's white card. */
export function ChatLoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 rounded-xl bg-card px-6 text-center"
      role="alert"
    >
      <p className="text-body">{t('chat.loadError')}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t('errors.retry')}
      </Button>
    </div>
  );
}
