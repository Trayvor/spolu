import { useTranslation } from 'react-i18next';
import type { SourceMessage as SourceMessageDto } from '@spolu/shared';

const EXCERPT_LENGTH = 140;

/**
 * "Created from a message": the chat message an AI-made task came from. The link is a plain
 * anchor: Phase 5 owns the `?message=` search param of the chat route.
 */
export function SourceMessage({
  groupId,
  message,
}: {
  groupId: string;
  message: SourceMessageDto;
}) {
  const { t } = useTranslation();
  const text =
    message.excerpt.length > EXCERPT_LENGTH
      ? `${message.excerpt.slice(0, EXCERPT_LENGTH)}…`
      : message.excerpt;
  return (
    <section aria-label={t('tasks.panel.fromMessage')} className="rounded-lg bg-secondary p-4">
      <h3 className="text-button font-semibold">{t('tasks.panel.fromMessage')}</h3>
      <p className="mt-1 text-tiny font-semibold text-muted-foreground">{message.authorName}</p>
      <p className="mt-1 break-words text-body">{text}</p>
      <a
        href={`/groups/${encodeURIComponent(groupId)}/chat?message=${encodeURIComponent(message.id)}`}
        className="mt-2 inline-block text-button font-semibold underline underline-offset-4 hover:text-neutral"
      >
        {t('tasks.panel.openMessage')}
      </a>
    </section>
  );
}
