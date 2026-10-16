import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { markAllRead, taskChatQuery } from '@/features/chat/api';
import { ChatLoadError } from '@/features/chat/chat-load-error';
import { Conversation } from '@/features/chat/conversation';
import { useDocumentVisible } from '@/features/chat/use-document-visible';
import { useMessageTaskTools } from '@/features/task-split/use-message-task-tools';

/**
 * The task's chat in the panel's Chat tab: the shared `<Conversation>` for the task's channel
 * (created by the server on first open), with threads opening over the list. Opening the tab
 * reads the whole chat, threads included, once the channel is known and the page is visible.
 * Like the group's Chat tab, messages show "Turned into tasks:" and offer "Turn into tasks"
 * (`useMessageTaskTools`, whose action list and footer stay the same across renders).
 * Must render under the group layout (`GroupRoomProvider`).
 */
export function TaskChat({ groupId, taskId }: { groupId: string; taskId: string }) {
  const { data, isError, refetch } = useQuery(taskChatQuery(taskId));
  const tools = useMessageTaskTools(groupId);
  const visible = useDocumentVisible();
  const channelId = data?.id;

  // Once per opening of the tab (and per channel): a failure is left alone, the next opening
  // tries again.
  const marked = useRef<string | null>(null);
  useEffect(() => {
    if (channelId === undefined || !visible || marked.current === channelId) return;
    marked.current = channelId;
    // Task 9 invalidates the board's task-chat summaries here.
    // A failed mark only leaves the chat unread; the next opening of the tab tries again.
    markAllRead(channelId).catch(() => undefined);
  }, [channelId, visible]);

  if (data) {
    return (
      <>
        <Conversation
          channelId={data.id}
          groupId={groupId}
          threadMode="over"
          messageActions={tools.messageActions}
          renderMessageFooter={tools.renderMessageFooter}
        />
        {tools.element}
      </>
    );
  }
  if (isError) return <ChatLoadError onRetry={() => void refetch()} />;
  return <div className="h-full rounded-xl bg-card" aria-busy="true" />;
}
