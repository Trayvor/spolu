import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { groupChatQuery } from './api';
import { Conversation } from './conversation';
import { useChatSearch } from './use-chat-search';

/**
 * The group's chat, filling the window height below the group header and tabs (header pill, page
 * padding, group header and tabs add up to about 260 px), never shorter than 360 px.
 *
 * Links without a channel (`?thread=` / `?message=` without `&c=`) are the group chat's: the tab
 * claims them before it shows the conversation, so the window loads once, at the right place.
 */
export function ChatTab() {
  const { t } = useTranslation();
  const { groupId } = useParams({ strict: false });
  const { data, isError, refetch } = useQuery({
    ...groupChatQuery(groupId ?? ''),
    enabled: groupId !== undefined,
  });
  const { unscoped, adopt } = useChatSearch(data?.id);
  const claim = unscoped && data !== undefined;
  useEffect(() => {
    if (claim) adopt();
  }, [claim, adopt]);

  return (
    <>
      <div className="h-[calc(100dvh-260px)] min-h-[360px]">
        {data && groupId
          ? !unscoped && <Conversation channelId={data.id} groupId={groupId} />
          : isError && (
              <div
                className="flex h-full flex-col items-center justify-center gap-3 rounded-xl bg-card px-6 text-center"
                role="alert"
              >
                <p className="text-body">{t('chat.loadError')}</p>
                <Button variant="outline" size="sm" onClick={() => void refetch()}>
                  {t('errors.retry')}
                </Button>
              </div>
            )}
      </div>
      <Outlet />
    </>
  );
}
