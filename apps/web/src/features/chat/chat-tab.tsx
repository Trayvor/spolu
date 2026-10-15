import { useQuery } from '@tanstack/react-query';
import { Outlet, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { groupChatQuery } from './api';
import { Conversation } from './conversation';

/**
 * The group's chat, filling the window height below the group header and tabs (header pill, page
 * padding, group header and tabs add up to about 260 px), never shorter than 420 px.
 */
export function ChatTab() {
  const { t } = useTranslation();
  const { groupId } = useParams({ strict: false });
  const { data, isError, refetch } = useQuery({
    ...groupChatQuery(groupId ?? ''),
    enabled: groupId !== undefined,
  });

  return (
    <>
      <div className="h-[calc(100dvh-260px)] min-h-[420px]">
        {data && groupId ? (
          <Conversation channelId={data.id} groupId={groupId} />
        ) : (
          isError && (
            <div
              className="flex h-full flex-col items-center justify-center gap-3 rounded-xl bg-card px-6 text-center"
              role="alert"
            >
              <p className="text-body">{t('chat.loadError')}</p>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                {t('errors.retry')}
              </Button>
            </div>
          )
        )}
      </div>
      <Outlet />
    </>
  );
}
