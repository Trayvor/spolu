import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useParams } from '@tanstack/react-router';
import { useMessageTaskTools } from '@/features/task-split/use-message-task-tools';
import { groupChatQuery } from './api';
import { ChatLoadError } from './chat-load-error';
import { Conversation } from './conversation';
import { useChatSearch } from './use-chat-search';

/**
 * The group's chat, filling the window height left below the group header and tabs (the layouts
 * are flex columns down to here), never shorter than 360 px. The card is laid out absolutely in
 * that room, so its messages scroll inside it and never stretch the page.
 *
 * Links without a channel (`?thread=` / `?message=` without `&c=`) are the group chat's: the tab
 * claims them before it shows the conversation, so the window loads once, at the right place.
 */
export function ChatTab() {
  const { groupId } = useParams({ strict: false });
  const { data, isError, refetch } = useQuery({
    ...groupChatQuery(groupId ?? ''),
    enabled: groupId !== undefined,
  });
  const { unscoped, adopt } = useChatSearch(data?.id);
  const tools = useMessageTaskTools(groupId ?? '');
  const claim = unscoped && data !== undefined;
  useEffect(() => {
    if (claim) adopt();
  }, [claim, adopt]);

  return (
    <>
      <div data-testid="chat-card" className="relative min-h-[360px] flex-1">
        <div className="absolute inset-0">
          {data && groupId
            ? !unscoped && (
                <Conversation
                  channelId={data.id}
                  groupId={groupId}
                  messageActions={tools.messageActions}
                  renderMessageFooter={tools.renderMessageFooter}
                />
              )
            : isError && <ChatLoadError onRetry={() => void refetch()} />}
        </div>
      </div>
      {tools.element}
      <Outlet />
    </>
  );
}
