import { useEffect, useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { MessageDto } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { markAllRead, taskChatQuery } from '@/features/chat/api';
import { Conversation, type MessageAction } from '@/features/chat/conversation';
import { useDocumentVisible } from '@/features/chat/use-document-visible';

/**
 * The task's chat in the panel's Chat tab: the shared `<Conversation>` for the task's channel
 * (created by the server on first open), with threads opening over the list. Opening the tab
 * reads the whole chat, threads included, once the channel is known and the page is visible.
 * Must render under the group layout (`GroupRoomProvider`). Pass stable `messageActions` and
 * `renderMessageFooter` (memoised), or every row re-renders.
 */
export function TaskChat({
  groupId,
  taskId,
  messageActions,
  renderMessageFooter,
}: {
  groupId: string;
  taskId: string;
  messageActions?: MessageAction[];
  renderMessageFooter?: (message: MessageDto) => ReactNode;
}) {
  const { t } = useTranslation();
  const { data, isError, refetch } = useQuery(taskChatQuery(taskId));
  const visible = useDocumentVisible();
  const channelId = data?.id;

  // Once per opening of the tab (and per channel): a failure is left alone, the next opening
  // tries again.
  const marked = useRef<string | null>(null);
  useEffect(() => {
    if (channelId === undefined || !visible || marked.current === channelId) return;
    marked.current = channelId;
    // Task 9 invalidates the board's task-chat summaries here.
    markAllRead(channelId).catch(() => undefined);
  }, [channelId, visible]);

  if (data) {
    return (
      <Conversation
        channelId={data.id}
        groupId={groupId}
        threadMode="over"
        messageActions={messageActions}
        renderMessageFooter={renderMessageFooter}
      />
    );
  }
  if (isError) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 rounded-xl bg-card px-6 text-center"
        role="alert"
      >
        <p className="text-body">{t('chat.loadError')}</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {t('errors.retry')}
        </Button>
      </div>
    );
  }
  return <div className="h-full rounded-xl bg-card" aria-busy="true" />;
}
