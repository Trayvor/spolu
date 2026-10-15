import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MessageDto } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth/use-session';
import { Composer } from './composer';
import type { MessageAction } from './message-item';
import { MessageList } from './message-list';
import { HIGHLIGHT_MS, ThreadPanel } from './thread-panel';
import { useChannelMessages } from './use-channel-messages';
import { useChatSearch } from './use-chat-search';

export type { MessageAction } from './message-item';

/** The chat waits this long at the bottom before it marks the newest message read. */
const MARK_READ_DELAY_MS = 1000;

export interface ConversationProps {
  channelId: string;
  groupId: string;
  /** Extra hover-toolbar entries on every saved message (main list and thread panel). */
  messageActions?: MessageAction[];
  /** Rendered under every saved message's content (main list and thread panel). */
  renderMessageFooter?: (message: MessageDto) => ReactNode;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

/**
 * One chat: the message list, its composer and the thread panel (right side, 400 px, from 1024 px;
 * a full-width panel with a back button below). It knows nothing about what the channel belongs
 * to: the group chat and Phase 9's task chats use it alike. It fills its parent's height.
 *
 * It must be rendered under the group layout (`GroupRoomProvider`): catch-up after a reconnect
 * follows the group room's join counter.
 *
 * URL: `?thread=<rootId>` opens a thread (and survives a reload); `?message=<id>` opens the chat
 * around that message and highlights it for 2 s (with `thread`, the reply in the panel).
 */
export function Conversation({
  channelId,
  groupId,
  messageActions,
  renderMessageFooter,
}: ConversationProps) {
  const { t } = useTranslation();
  const meId = useSession()?.id ?? '';
  const search = useChatSearch();
  const { message: linked, thread: threadId, clearMessage, setThread } = search;
  const chat = useChannelMessages(channelId, { groupId, aroundMessageId: linked });
  const { window: win, markRead, jumpToLatest, send } = chat;
  const column = useRef<HTMLDivElement>(null);
  const visible = useDocumentVisible();
  // The list opens away from the bottom when it shows a linked message.
  const [atBottom, setAtBottom] = useState(() => linked === undefined);
  const [endSignal, setEndSignal] = useState(0);

  // The linked message stays highlighted for 2 s after the window has loaded, then leaves the URL.
  useEffect(() => {
    if (linked === undefined || !win.loaded) return;
    const timer = setTimeout(clearMessage, HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [linked, win.loaded, clearMessage]);

  // Marks read once the reader has been at the bottom of the newest page for a moment.
  const newest = win.messages.at(-1)?.createdAt;
  const unreadSeen =
    atBottom &&
    visible &&
    win.loaded &&
    !win.hasNewer &&
    newest !== undefined &&
    (win.lastReadAt === null || newest > win.lastReadAt);
  useEffect(() => {
    if (!unreadSeen || newest === undefined) return;
    const timer = setTimeout(() => {
      // A failure is left alone: the next message or scroll to the bottom tries again.
      markRead(newest).catch(() => undefined);
    }, MARK_READ_DELAY_MS);
    return () => clearTimeout(timer);
  }, [unreadSeen, newest, markRead]);

  const onSend = useCallback(
    ({ body, fileIds }: { body: string; fileIds: string[] }) => {
      // The new message is shown at the bottom of the newest page.
      if (win.hasNewer) void jumpToLatest();
      setEndSignal((n) => n + 1);
      void send({ body, fileIds });
    },
    [win.hasNewer, jumpToLatest, send],
  );

  const openThread = useCallback((message: MessageDto) => setThread(message.id), [setThread]);
  const closeThread = useCallback(() => setThread(undefined), [setThread]);
  const threadPending = useMemo(
    () => win.pending.filter((p) => p.input.parentId === threadId),
    [win.pending, threadId],
  );

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden rounded-xl bg-card">
      <div ref={column} className="flex min-w-0 flex-1 flex-col">
        {chat.error !== null && !win.loaded ? (
          <div
            className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
            role="alert"
          >
            <p className="text-body">{t('chat.loadError')}</p>
            <Button variant="outline" size="sm" onClick={() => void jumpToLatest()}>
              {t('errors.retry')}
            </Button>
          </div>
        ) : (
          <MessageList
            window={win}
            meId={meId}
            groupId={groupId}
            onLoadOlder={chat.loadOlder}
            onLoadNewer={chat.loadNewer}
            onJumpToLatest={jumpToLatest}
            highlightId={linked}
            messageActions={messageActions}
            renderMessageFooter={renderMessageFooter}
            onOpenThread={openThread}
            onRetry={chat.retry}
            onAtBottomChange={setAtBottom}
            onMessageChanged={chat.applyLocal}
            endSignal={endSignal}
          />
        )}
        <div className="shrink-0 px-4 pb-4">
          {/* The only composer that takes dropped files on the chat column. */}
          <Composer mode="new" groupId={groupId} dropTarget={column} onSubmit={onSend} />
        </div>
      </div>
      {threadId !== undefined && (
        <ThreadPanel
          key={threadId}
          rootId={threadId}
          channelId={channelId}
          groupId={groupId}
          meId={meId}
          pending={threadPending}
          send={send}
          retry={chat.retry}
          onMessageChanged={chat.applyLocal}
          highlightId={linked}
          messageActions={messageActions}
          renderMessageFooter={renderMessageFooter}
          onClose={closeThread}
        />
      )}
    </div>
  );
}
