import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MessageDto } from '@spolu/shared';
import { useGroupPeople } from '@/features/groups/use-group-people';
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
  onRetry?: (clientId: string) => void;
  /**
   * Called when the list reaches or leaves the bottom (the conversation marks the chat read). The
   * list starts at the bottom, unless it opens at `highlightId`.
   */
  onAtBottomChange?: (atBottom: boolean) => void;
  /** An edit or delete of the reader's own message was answered; apply it to the window. Apply it to the window only: it must not move lastSeq or catch-up bookkeeping (a delete copy has a fabricated changeSeq and deletedAt). */
  onMessageChanged?: (message: MessageDto) => void;
  /** A change of this value scrolls to the end and follows it again (the reader just sent). */
  endSignal?: number;
}

/** Pixels from the end that still count as "at the end". */
const EDGE = 24;
/** Pixels from an end at which the next page is asked for. */
const PREFETCH = 120;

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
    <div className="flex items-center gap-3 px-4 pt-3 text-micro font-semibold text-brand-purple">
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
  onRetry,
  onAtBottomChange,
  onMessageChanged,
  endSignal = 0,
}: MessageListProps) {
  const { t } = useTranslation();
  const people = useGroupPeople(groupId).data;
  const scroller = useRef<HTMLDivElement>(null);
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
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (endSignal !== endSignalSeen.current) {
      endSignalSeen.current = endSignal;
      stick.current = true;
    }
    if (stick.current) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    const kept = anchor.current;
    const row = kept && el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(kept.id)}"]`);
    if (kept && row) el.scrollTop = row.offsetTop - kept.offset;
    anchor.current = captureAnchor(el);
  }, [firstId, lastId, pending.length, win.loaded, endSignal]);

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
  }, [highlightId, win.messages]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    const fromEnd = el.scrollHeight - el.scrollTop - el.clientHeight;
    const bottom = fromEnd <= EDGE && !win.hasNewer;
    stick.current = bottom;
    anchor.current = captureAnchor(el);
    if (bottom !== atBottom) {
      setAtBottom(bottom);
      onAtBottomChange?.(bottom);
      if (bottom) setUnseen(false);
    }
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
        className="relative h-full overflow-y-auto overscroll-contain pb-3"
      >
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
              onChanged={onMessageChanged}
              highlighted={message.id === highlightId}
            />
          );
        })}
        {/* Unsent rows get no messageActions and no footer: they are not saved yet. */}
        {pending.map((p, i) => (
          <MessageItem
            key={p.clientId}
            message={pendingAsMessage(p, lastMessage?.channelId ?? '', author)}
            groupId={groupId}
            showHeader={i === 0 && lastMessage?.author.id !== meId}
            mentionsMe={false}
            meId={meId}
            nameOf={nameOf}
            pending={p.status}
            onRetry={onRetry}
          />
        ))}
      </div>
      {showJump && (
        <button
          type="button"
          onClick={jump}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-tiny font-semibold text-primary-foreground shadow-lift hover:bg-ink-hover"
        >
          {t('chat.jumpToLatest')}
        </button>
      )}
    </div>
  );
}
