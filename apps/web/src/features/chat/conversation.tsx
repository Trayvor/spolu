import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MessageDto } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth/use-session';
import { useMediaQuery } from '@/lib/use-media-query';
import { ChatScopeProvider, chatPeopleQuery, type ChatScope } from './chat-scope';
import { Composer, type ComposerHandle } from './composer';
import type { MessageAction } from './message-item';
import { MessageList } from './message-list';
import { HIGHLIGHT_MS, ThreadPanel } from './thread-panel';
import { useChannelMessages, type SendInput } from './use-channel-messages';
import { useDocumentVisible } from './use-document-visible';
import { useChatSearch } from './use-chat-search';
import { useUnreadThreads } from './use-unread-threads';

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
  /**
   * Where an open thread goes: `side` (default) beside the list from 1024 px and over it below;
   * `over` always over the list, for narrow hosts such as the task panel.
   */
  threadMode?: 'side' | 'over';
  /** Where the chat reads its people and uploads its files (default: the group's). */
  scope?: ChatScope;
}

const GROUP_SCOPE: ChatScope = {};
/** The chat's own composer, as a focus target (a thread's is its root id). */
const MAIN = '';

/**
 * One chat: the message list, its composer and the thread panel (right side, 400 px, from 1024 px;
 * a full-width panel with a back button below, and at every width with `threadMode="over"`). It knows nothing about what the channel belongs
 * to: the group chat and Phase 9's task chats use it alike. It fills its parent's height.
 *
 * It must be rendered under the group layout (`GroupRoomProvider`): catch-up after a reconnect
 * follows the group room's join counter.
 *
 * URL: `?thread=<rootId>&c=<channelId>` opens a thread (and survives a reload);
 * `?message=<id>&c=<channelId>` opens the chat around that message and highlights it for 2 s
 * (with `thread`, the reply in the panel). Params of another channel are ignored, so two
 * conversations on one page never open each other's threads; params without `c` belong to
 * whoever adopts them (the group's Chat tab).
 */
export function Conversation({
  channelId,
  groupId,
  messageActions,
  renderMessageFooter,
  threadMode = 'side',
  scope = GROUP_SCOPE,
}: ConversationProps) {
  const { t } = useTranslation();
  const meId = useSession()?.id ?? '';
  const search = useChatSearch(channelId);
  const { message: linked, thread: threadId, reply, clearMessage, clearReply, setThread } = search;
  const composer = useRef<ComposerHandle>(null);
  // N6a: `&reply=1` focuses the composer of the open thread, else the chat's. The field may still
  // be loading (its own chunk), so the chosen composer also gets `autoFocus`; a thread opened
  // later starts at its heading again.
  const place = threadId ?? MAIN;
  const [focusTarget, setFocusTarget] = useState<string | null>(() => (reply ? place : null));
  // Adjusted while rendering (not in an effect): the param's arrival picks the target, and moving
  // to another thread (or out of it) drops it.
  const [replySeen, setReplySeen] = useState(reply);
  if (reply !== replySeen) {
    setReplySeen(reply);
    if (reply) setFocusTarget(place);
  } else if (focusTarget !== null && focusTarget !== place) {
    setFocusTarget(null);
  }
  useEffect(() => {
    if (!reply) return;
    if (place === MAIN) composer.current?.focus();
    clearReply();
    // Once per arrival of the param.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reply]);
  const peopleChannelId = scope.peopleChannelId;
  const peopleKey = useMemo(
    () => chatPeopleQuery({ peopleChannelId }, groupId).queryKey,
    [peopleChannelId, groupId],
  );
  const chat = useChannelMessages(channelId, { groupId, aroundMessageId: linked, peopleKey });
  const { window: win, markRead, jumpToLatest, send, around } = chat;
  const column = useRef<HTMLDivElement>(null);
  const visible = useDocumentVisible();
  // The open thread is read while the page is visible.
  const unreadThreads = useUnreadThreads(channelId, groupId, visible ? threadId : undefined);
  // Below 1024 px (or always, in `over` mode) an open thread covers the list.
  const wide = useMediaQuery('(min-width: 1024px)');
  const over = threadMode === 'over';
  const covered = (over || !wide) && threadId !== undefined;
  // The list opens away from the bottom when it shows a linked message.
  const [atBottom, setAtBottom] = useState(() => linked === undefined);
  const [endSignal, setEndSignal] = useState(0);

  // The linked message stays highlighted for 2 s once its page has arrived, then leaves the URL.
  const linkSettled = linked !== undefined && around?.messageId === linked;
  useEffect(() => {
    if (!linkSettled) return;
    const timer = setTimeout(clearMessage, HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [linkSettled, clearMessage]);
  // A linked reply is not in the list: the list shows its thread root (the page's target).
  const listHighlight = linkSettled ? (around?.targetId ?? undefined) : linked;

  // Marks read once the reader has been at the bottom of the newest page for a moment.
  const newest = win.messages.at(-1)?.createdAt;
  const unreadSeen =
    atBottom &&
    !covered &&
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
    // Everything the composer picked goes on as it is: a field named here could be forgotten.
    (input: SendInput) => {
      // The new message is shown at the bottom of the newest page.
      if (win.hasNewer) void jumpToLatest();
      setEndSignal((n) => n + 1);
      void send(input);
    },
    [win.hasNewer, jumpToLatest, send],
  );

  /** What had focus when the thread opened; it gets focus back when the thread closes. */
  const opener = useRef<Element | null>(null);
  const openThread = useCallback(
    (message: MessageDto) => {
      opener.current = document.activeElement;
      setThread(message.id);
    },
    [setThread],
  );
  const closeThread = useCallback(() => setThread(undefined), [setThread]);

  // However the thread closed (button, Esc, Back), focus returns to where the reader was: the
  // opener, else the root message's "N replies" link, else its first button.
  const shownThread = useRef(threadId);
  useEffect(() => {
    const closed = shownThread.current;
    shownThread.current = threadId;
    if (closed === undefined || threadId !== undefined) return;
    const back = opener.current;
    opener.current = null;
    if (back instanceof HTMLElement && back.isConnected && column.current?.contains(back)) {
      back.focus();
      return;
    }
    const row = column.current?.querySelector(`[data-message-id="${CSS.escape(closed)}"]`);
    row?.querySelector<HTMLElement>('[data-thread-link], button')?.focus();
  }, [threadId]);
  const threadPending = useMemo(
    () => win.pending.filter((p) => p.input.parentId === threadId),
    [win.pending, threadId],
  );

  return (
    <ChatScopeProvider scope={scope}>
      <div className="relative flex h-full min-h-0 overflow-hidden rounded-xl bg-card">
        <div ref={column} inert={covered} className="flex min-w-0 flex-1 flex-col">
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
              highlightId={listHighlight}
              messageActions={messageActions}
              renderMessageFooter={renderMessageFooter}
              onOpenThread={openThread}
              unreadThreads={unreadThreads.unread}
              onRetry={chat.retry}
              onAtBottomChange={setAtBottom}
              onMessageChanged={chat.applyLocal}
              endSignal={endSignal}
            />
          )}
          <div className="shrink-0 px-4 pb-4">
            {/* The only composer that takes dropped files on the chat column. */}
            <Composer
              ref={composer}
              autoFocus={focusTarget === MAIN}
              mode="new"
              groupId={groupId}
              channelId={channelId}
              dropTarget={column}
              onSubmit={onSend}
            />
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
            over={over}
            focusComposer={focusTarget === threadId}
            onClose={closeThread}
          />
        )}
      </div>
    </ChatScopeProvider>
  );
}
