import { MessageSkeletons } from '@/components/ui/skeleton';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MessageDto } from '@spolu/shared';
import { useChatPeople } from './chat-scope';
import type { ChannelWindow } from './channel-window';
import { MessageItem, type MessageAction } from './message-item';
import { buildRows, localDay, pendingAsMessage } from './message-rows';

export interface MessageListProps {
  window: ChannelWindow;
  meId: string;
  groupId: string;
  onLoadOlder: () => void;
  onLoadNewer: () => void;
  onJumpToLatest: () => void;
  /** The message to scroll to and mark (the conversation clears it after 2 s). */
  highlightId?: string | null;
  messageActions?: MessageAction[];
  renderMessageFooter?: (message: MessageDto) => ReactNode;
  onOpenThread?: (message: MessageDto) => void;
  /** Roots of threads with replies the reader has not read: their "N replies" link gets a dot. */
  unreadThreads?: ReadonlySet<string>;
  onRetry?: (clientId: string) => void;
  /**
   * Called when the list reaches or leaves the bottom (the conversation marks the chat read). The
   * list starts at the bottom, unless it opens at `highlightId`.
   */
  onAtBottomChange?: (atBottom: boolean) => void;
  /**
   * An edit or delete of the reader's own message was answered. Apply it to the window only: it
   * must not move lastSeq or catch-up bookkeeping (a delete copy has a fabricated changeSeq and
   * deletedAt).
   */
  onMessageChanged?: (message: MessageDto) => void;
  /** A change of this value scrolls to the end and follows it again (the reader just sent). */
  endSignal?: number;
}

/** Pixels from the end that still count as "at the end". */
const EDGE = 24;
/** Pixels from an end at which the next page is asked for. */
const PREFETCH = 120;
/** Pixels left above the "new messages" line when a chat opens at it. */
const UNREAD_GAP = 8;

/** The first row that reaches into the viewport, with its offset from the viewport top. */
function captureAnchor(el: HTMLElement | null): { id: string; offset: number } | null {
  if (!el) return null;
  for (const row of el.querySelectorAll<HTMLElement>('[data-message-id]')) {
    if (row.offsetTop + row.offsetHeight > el.scrollTop) {
      return { id: row.dataset.messageId!, offset: row.offsetTop - el.scrollTop };
    }
  }
  return null;
}

/** A centred day label between two lines (main list and thread panel). */
export function DayDivider({ date }: { date: string }) {
  const { t, i18n } = useTranslation();
  const label = useMemo(() => {
    const now = new Date();
    if (date === localDay(now)) return t('chat.today');
    if (date === localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) {
      return t('chat.yesterday');
    }
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    return new Intl.DateTimeFormat(i18n.language, {
      day: 'numeric',
      month: 'long',
      year: y === now.getFullYear() ? undefined : 'numeric',
    }).format(new Date(y, m - 1, d));
  }, [date, t, i18n.language]);
  return (
    <div className="flex items-center gap-3 px-4 pt-4 text-micro font-semibold text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function NewMessagesLine() {
  const { t } = useTranslation();
  return (
    <div
      data-new-messages=""
      className="flex items-center gap-3 px-4 pt-3 text-micro font-semibold text-brand-purple-ink"
    >
      <span className="h-px flex-1 bg-brand-purple" />
      <span>{t('chat.newMessages')}</span>
      <span className="h-px flex-1 bg-brand-purple" />
    </div>
  );
}

/** The scrolling message list of one chat. It is the only scrolling element of the conversation. */
export function MessageList({
  window: win,
  meId,
  groupId,
  onLoadOlder,
  onLoadNewer,
  onJumpToLatest,
  highlightId,
  messageActions,
  renderMessageFooter,
  onOpenThread,
  unreadThreads,
  onRetry,
  onAtBottomChange,
  onMessageChanged,
  endSignal = 0,
}: MessageListProps) {
  const { t } = useTranslation();
  const people = useChatPeople(groupId).data;
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const names = useMemo(() => new Map((people ?? []).map((p) => [p.id, p.name])), [people]);
  const nameOf = useMemo(() => (id: string) => names.get(id), [names]);
  const rows = useMemo(
    () => buildRows(win.messages, { lastReadAt: win.unreadAnchor, meId, now: new Date() }),
    [win.messages, win.unreadAnchor, meId],
  );
  const pending = useMemo(() => win.pending.filter((p) => !p.input.parentId), [win.pending]);

  const firstId = win.messages[0]?.id;
  const lastId = win.messages.at(-1)?.id;

  // Follow the end while the reader is at the end; a link to a message starts away from it.
  const stick = useRef(!highlightId);
  const [atBottom, setAtBottom] = useState(!highlightId);
  const [unseen, setUnseen] = useState(false);
  /**
   * The first visible row and its offset, kept current by every scroll. When the first loaded
   * row changes (an older page arrived, or the oldest rows were dropped at the cap) the layout
   * effect puts that row back at the same offset, so the view does not jump.
   */
  const anchor = useRef<{ id: string; offset: number } | null>(null);

  const endSignalSeen = useRef(endSignal);
  /** Whether the first loaded page was placed (at the first unread message or at the end). */
  const opened = useRef(false);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (endSignal !== endSignalSeen.current) {
      endSignalSeen.current = endSignal;
      stick.current = true;
    }
    if (!opened.current && win.loaded && rows.length > 0) {
      opened.current = true;
      // A chat read before opens at its first unread message; one never read opens at the end.
      const line =
        !highlightId && win.unreadAnchor !== null
          ? el.querySelector<HTMLElement>('[data-new-messages]')
          : null;
      if (line) {
        el.scrollTop = Math.max(0, line.offsetTop - UNREAD_GAP);
        anchor.current = captureAnchor(el);
        // All unread rows may fit in view: then this is the end, and the chat is read.
        syncBottom();
        return;
      }
    }
    if (stick.current) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    const kept = anchor.current;
    const row = kept && el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(kept.id)}"]`);
    if (kept && row) el.scrollTop = row.offsetTop - kept.offset;
    anchor.current = captureAnchor(el);
    // Runs when rows arrive or leave at an end. The opening reads highlightId and the unread
    // anchor once; a later change of either must not move the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstId, lastId, pending.length, win.loaded, endSignal]);

  /**
   * Rows change height after the first layout (`content-visibility` estimates rows it has not
   * drawn, images and names arrive later) without a scroll event. Keep the end in view while the
   * reader follows it, else keep the first visible row where it was.
   */
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (stick.current) {
        el.scrollTop = el.scrollHeight;
        return;
      }
      const kept = anchor.current;
      const row =
        kept && el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(kept.id)}"]`);
      if (kept && row) el.scrollTop = row.offsetTop - kept.offset;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  const seenLast = useRef(lastId);
  useEffect(() => {
    if (lastId !== seenLast.current && !stick.current) setUnseen(true);
    seenLast.current = lastId;
  }, [lastId]);

  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightId) {
      scrolledTo.current = null;
      return;
    }
    if (scrolledTo.current === highlightId) return;
    const row = scroller.current?.querySelector(`[data-message-id="${CSS.escape(highlightId)}"]`);
    if (!row) return;
    scrolledTo.current = highlightId;
    stick.current = false;
    row.scrollIntoView?.({ block: 'center' });
    // A page too short to scroll never fires a scroll event: measure once here.
    syncBottom();
  });

  /** Whether the end of the newest page is in view; tells the conversation when it changes. */
  function syncBottom() {
    const el = scroller.current;
    if (!el) return;
    const fromEnd = el.scrollHeight - el.scrollTop - el.clientHeight;
    const bottom = fromEnd <= EDGE && !win.hasNewer;
    stick.current = bottom;
    if (bottom !== atBottom) {
      setAtBottom(bottom);
      onAtBottomChange?.(bottom);
      if (bottom) setUnseen(false);
    }
  }

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    const fromEnd = el.scrollHeight - el.scrollTop - el.clientHeight;
    syncBottom();
    anchor.current = captureAnchor(el);
    if (el.scrollTop < PREFETCH && win.hasOlder) onLoadOlder();
    if (fromEnd < PREFETCH && win.hasNewer) onLoadNewer();
  }

  function jump() {
    setUnseen(false);
    stick.current = true;
    if (win.hasNewer) onJumpToLatest();
    else if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }

  const me = people?.find((p) => p.id === meId);
  const lastMessage = win.messages.at(-1);
  const author = { id: meId, name: me?.name ?? '', isAdmin: me?.isAdmin ?? false };

  const empty = win.loaded && rows.length === 0 && pending.length === 0;
  const showJump = !atBottom && (unseen || win.hasNewer);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="relative h-full overflow-y-auto overscroll-contain pt-9 pb-3"
        aria-busy={!win.loaded || undefined}
      >
        <div ref={content}>
          {!win.loaded && rows.length === 0 && <MessageSkeletons />}
          {empty && (
            <p className="px-6 py-10 text-center text-body text-muted-foreground">
              {t('chat.empty')}
            </p>
          )}
          {rows.map((row) => {
            if (row.kind === 'day') return <DayDivider key={`day-${row.date}`} date={row.date} />;
            if (row.kind === 'new') return <NewMessagesLine key="new" />;
            const { message } = row;
            return (
              <MessageItem
                key={message.id}
                message={message}
                groupId={groupId}
                showHeader={row.showHeader}
                mentionsMe={row.mentionsMe}
                meId={meId}
                nameOf={nameOf}
                messageActions={messageActions}
                renderMessageFooter={renderMessageFooter}
                onOpenThread={onOpenThread}
                unreadReplies={unreadThreads?.has(message.id) ?? false}
                onChanged={onMessageChanged}
                highlighted={message.id === highlightId}
              />
            );
          })}
          {/* Unsent rows get no messageActions and no footer: they are not saved yet. */}
          {/* A message just sent fades in where it lands. */}
          {pending.map((p, i) => (
            <div key={p.clientId} className="animate-fade-in">
              <MessageItem
                message={pendingAsMessage(p, lastMessage?.channelId ?? '', author)}
                groupId={groupId}
                showHeader={i === 0 && lastMessage?.author.id !== meId}
                mentionsMe={false}
                meId={meId}
                nameOf={nameOf}
                pending={p.status}
                failReason={p.failReason}
                onRetry={onRetry}
              />
            </div>
          ))}
        </div>
      </div>
      {showJump && (
        <button
          type="button"
          onClick={jump}
          className="absolute bottom-3 left-1/2 min-h-11 -translate-x-1/2 animate-fade-in rounded-full bg-primary px-4 py-2 text-tiny font-semibold text-primary-foreground shadow-lift hover:bg-ink-hover"
        >
          {t('chat.jumpToLatest')}
        </button>
      )}
    </div>
  );
}
