import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { MessageDto } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { useGroupPeople } from '@/features/groups/use-group-people';
import type { Pending } from './channel-window';
import { Composer } from './composer';
import { BackIcon, CloseIcon } from './icons';
import { MessageItem, type MessageAction } from './message-item';
import { DayDivider } from './message-list';
import { buildRows, pendingAsMessage } from './message-rows';
import type { SendInput } from './use-channel-messages';
import { useThread } from './use-thread';

/** How long a linked or quoted message stays highlighted. */
export const HIGHLIGHT_MS = 2000;

export interface ThreadPanelProps {
  rootId: string;
  channelId: string;
  groupId: string;
  meId: string;
  /** The conversation's unsent rows of this thread (`input.parentId === rootId`). */
  pending: Pending[];
  send: (input: SendInput) => unknown;
  retry: (clientId: string) => unknown;
  /** Seq-neutral: an own edit or delete answered by the server (see `MessageList`). */
  onMessageChanged?: (message: MessageDto) => void;
  /** A reply opened by URL (`?thread=&message=`); the conversation clears it after 2 s. */
  highlightId?: string | null;
  messageActions?: MessageAction[];
  renderMessageFooter?: (message: MessageDto) => ReactNode;
  onClose: () => void;
}

/**
 * One thread beside the chat: the root, a divider with the reply count, the replies and a
 * composer that sends replies (with an optional quote of one message of the thread). "Reply" on
 * any message of the thread quotes it; there are no nested threads. The rows come from the same
 * `buildRows` as the main list, without the "New messages" line. Render it with `key={rootId}`, so
 * another thread starts with a fresh quote and composer.
 */
export function ThreadPanel({
  rootId,
  channelId,
  groupId,
  meId,
  pending,
  send,
  retry,
  onMessageChanged,
  highlightId,
  messageActions,
  renderMessageFooter,
  onClose,
}: ThreadPanelProps) {
  const { t } = useTranslation();
  const { data: thread, isError, refetch } = useThread(rootId);
  const people = useGroupPeople(groupId).data;
  const names = useMemo(() => new Map((people ?? []).map((p) => [p.id, p.name])), [people]);
  const nameOf = useMemo(() => (id: string) => names.get(id), [names]);
  const panel = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  /** The reader is at (or near) the end of the thread, so new replies are followed. */
  const nearEnd = useRef(true);
  const [replyTo, setReplyTo] = useState<MessageDto | null>(null);
  /** The quoted reply the reader jumped to. */
  const [flash, setFlash] = useState<string | null>(null);

  const replies = thread?.replies;
  const rows = useMemo(
    () => buildRows(replies ?? [], { lastReadAt: undefined, meId, now: new Date() }),
    [replies, meId],
  );
  const byId = useMemo(() => {
    const map = new Map<string, MessageDto>();
    if (thread) for (const m of [thread.root, ...thread.replies]) map.set(m.id, m);
    return map;
  }, [thread]);
  const quoteOf = (id: string | null) => (id === null ? null : (byId.get(id) ?? null));

  const highlighted = flash ?? highlightId ?? null;

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  // Opening a thread moves focus into it (the heading, so screen readers announce it).
  useEffect(() => {
    heading.current?.focus();
  }, []);

  // Scroll to the highlighted message once it is rendered; otherwise follow the newest reply
  // when one is added while the reader is at the end, and always after the reader's own send
  // (never when a highlight ends, which would yank the reader away).
  const count = (replies?.length ?? 0) + pending.length;
  const seenCount = useRef(-1);
  const seenPending = useRef(pending.length);
  const scrolledTo = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !thread) return;
    const sent = pending.length > seenPending.current;
    seenPending.current = pending.length;
    const grew =
      count !== seenCount.current && (seenCount.current === -1 || nearEnd.current || sent);
    seenCount.current = count;
    if (highlighted) {
      if (scrolledTo.current === highlighted) return;
      const row = el.querySelector(`[data-message-id="${CSS.escape(highlighted)}"]`);
      if (!row) return;
      scrolledTo.current = highlighted;
      row.scrollIntoView?.({ block: 'center' });
      return;
    }
    scrolledTo.current = null;
    if (grew) el.scrollTop = el.scrollHeight;
  }, [highlighted, thread, count, pending.length]);

  function onScroll() {
    const el = scroller.current;
    if (el) nearEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
  }

  /** Esc inside the panel: first drops the quote, then closes the thread. */
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Escape' || e.defaultPrevented || e.nativeEvent.isComposing) return;
    // Keys from menus rendered in a portal bubble here through React; they are not ours.
    if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
    e.preventDefault();
    if (replyTo) setReplyTo(null);
    else onClose();
  }

  function reply(message: MessageDto) {
    setReplyTo(message);
    panel.current?.querySelector('textarea')?.focus();
  }

  const me = people?.find((p) => p.id === meId);
  const author = { id: meId, name: me?.name ?? '', isAdmin: me?.isAdmin ?? false };
  const lastAuthor = replies?.at(-1)?.author.id ?? thread?.root.author.id;
  const liveCount = replies?.filter((r) => r.deletedAt === null).length ?? 0;

  // A thread of another chat (a link meant for a chat mounted elsewhere) is not shown here.
  if (thread && thread.root.channelId !== channelId) return null;

  return (
    <section
      ref={panel}
      aria-label={t('chat.thread.title')}
      onKeyDown={onKeyDown}
      className="absolute inset-0 z-10 flex flex-col bg-card min-[1024px]:static min-[1024px]:w-[400px] min-[1024px]:shrink-0 min-[1024px]:border-l min-[1024px]:border-border"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2 min-[1024px]:px-4">
        <Button variant="ghost" size="sm" className="min-[1024px]:hidden" onClick={onClose}>
          <BackIcon />
          {t('chat.thread.back')}
        </Button>
        <h2
          ref={heading}
          tabIndex={-1}
          className="flex-1 text-button font-semibold outline-none max-[1023px]:sr-only"
        >
          {t('chat.thread.title')}
        </h2>
        <button
          type="button"
          aria-label={t('chat.thread.close')}
          title={t('chat.thread.close')}
          onClick={onClose}
          className="hidden size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground min-[1024px]:inline-flex"
        >
          <CloseIcon />
        </button>
      </header>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3"
      >
        {isError && !thread && (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center" role="alert">
            <p className="text-body">{t('chat.loadError')}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              {t('errors.retry')}
            </Button>
          </div>
        )}
        {thread && (
          <>
            <MessageItem
              message={thread.root}
              groupId={groupId}
              showHeader
              mentionsMe={false}
              inThread
              meId={meId}
              nameOf={nameOf}
              messageActions={messageActions}
              renderMessageFooter={renderMessageFooter}
              onReply={reply}
              onChanged={onMessageChanged}
              highlighted={thread.root.id === highlighted}
            />
            <div className="flex items-center gap-3 px-4 pt-3 text-micro font-semibold text-muted-foreground">
              <span>{t('chat.thread.replies', { count: liveCount })}</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            {rows.map((row) => {
              if (row.kind === 'day') return <DayDivider key={`day-${row.date}`} date={row.date} />;
              if (row.kind !== 'message') return null;
              const { message } = row;
              return (
                <MessageItem
                  key={message.id}
                  message={message}
                  groupId={groupId}
                  showHeader={row.showHeader}
                  mentionsMe={row.mentionsMe}
                  inThread
                  meId={meId}
                  nameOf={nameOf}
                  messageActions={messageActions}
                  renderMessageFooter={renderMessageFooter}
                  onReply={reply}
                  onQuoteClick={setFlash}
                  quote={quoteOf(message.replyToId)}
                  onChanged={onMessageChanged}
                  highlighted={message.id === highlighted}
                />
              );
            })}
            {pending.map((p, i) => (
              <MessageItem
                key={p.clientId}
                message={pendingAsMessage(p, channelId, author)}
                groupId={groupId}
                showHeader={i === 0 && lastAuthor !== meId}
                mentionsMe={false}
                inThread
                meId={meId}
                nameOf={nameOf}
                quote={quoteOf(p.input.replyToId ?? null)}
                pending={p.status}
                onRetry={retry}
              />
            ))}
          </>
        )}
      </div>

      <div className="shrink-0 px-4 pb-4">
        <Composer
          mode="thread"
          groupId={groupId}
          // Files dropped on this panel go to the thread; the main composer owns the chat column.
          dropTarget={panel}
          replyTo={replyTo ? { message: replyTo, onCancel: () => setReplyTo(null) } : undefined}
          onSubmit={({ body, fileIds, replyToId }) => {
            void send({ body, fileIds, parentId: rootId, ...(replyToId ? { replyToId } : {}) });
          }}
        />
      </div>
    </section>
  );
}
