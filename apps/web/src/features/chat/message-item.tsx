import {
  memo,
  useCallback,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type TouchEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { plainExcerpt, type MessageDto } from '@spolu/shared';
import { Avatar } from '@/components/avatar';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FileChip } from '@/features/files/file-chip';
import { ImagePreview } from '@/features/files/image-preview';
import { cn } from '@/lib/utils';
import { deleteMessage, editMessage } from './api';
import type { PendingFailReason } from './channel-window';
import { Composer } from './composer';
import { MessageBody } from './format/render';
import { Toast } from '@/components/ui/toast';
import { CopyIcon, EditIcon, MoreIcon, ReplyIcon, ThreadIcon, TrashIcon } from './icons';
import { KnowledgeCards } from './knowledge-cards';
import { WorkCards } from './work-cards';
import {
  AddReactionIcon,
  MorePicker,
  QuickReactions,
  ReactionChips,
  ReactionMenu,
  useReactions,
} from './reactions';

/**
 * An extra action on a message, shown in the desktop hover toolbar and as a row of the phone
 * action sheet (Phase 9 adds "Turn into tasks").
 */
export type MessageAction = {
  id: string;
  label: string;
  icon: ReactNode;
  /** Desktop: behind "More" instead of on the hover bar. The phone sheet lists every action. */
  inMenu?: boolean;
  /** Hidden on messages where this returns false (deleted and unsent messages never show actions). */
  isAvailable?: (message: MessageDto) => boolean;
  onSelect(message: MessageDto): void;
};

export interface MessageItemProps {
  message: MessageDto;
  groupId: string;
  showHeader: boolean;
  mentionsMe: boolean;
  /** Inside the thread panel: "Reply" quotes a message instead of opening a thread. */
  inThread?: boolean;
  meId: string;
  nameOf: (id: string) => string | undefined;
  messageActions?: MessageAction[];
  renderMessageFooter?: (message: MessageDto) => ReactNode;
  /** Thread panel: reply to this message. */
  onReply?: (message: MessageDto) => void;
  /** Main list: open this message's thread (toolbar and summary link). */
  onOpenThread?: (message: MessageDto) => void;
  /** Main list: the thread has replies the reader has not read (a dot on "N replies"). */
  unreadReplies?: boolean;
  onQuoteClick?: (messageId: string) => void;
  highlighted?: boolean;
  /** The message this one replies to (thread replies only). */
  quote?: MessageDto | null;
  /** A message still being sent (`sending`) or that failed; it has no actions. */
  pending?: 'sending' | 'failed';
  /** A failed row's known reason: someone mentioned in it can no longer be mentioned. */
  failReason?: PendingFailReason;
  onRetry?: (clientId: string) => void;
  /**
   * The server answered an edit (the updated message) or a delete (the message marked deleted).
   * Apply it to the window only: it must not move lastSeq or catch-up bookkeeping (a delete copy
   * has a fabricated changeSeq and deletedAt).
   */
  onChanged?: (message: MessageDto) => void;
}

const REPLY_EXCERPT = 80;
/** A finger held this long on a message opens its actions (touch screens). */
const LONG_PRESS_MS = 450;
/** After this long a held finger shows the press (the row shrinks a little); a quick scroll does not. */
const PRESS_FEEDBACK_MS = 120;
/** Moving the finger further than this (px) is a scroll, not a long press or a tap. */
const LONG_PRESS_SLOP = 10;
/** Two taps this close in time (ms) and space (px) are a double tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 30;
/** A tap on one of these does its own thing (opens the link, the file, the image): never a double tap. */
const OWN_TAP =
  'a,button,input,textarea,select,label,summary,video,audio,img,[role=button],[contenteditable=true]';

/**
 * Desktop (a pointer that hovers, 641 px and wider) shows the hover toolbar; everything else
 * opens the action sheet on a long press or a double tap, with a visually hidden "Message
 * actions" button for keyboards and screen readers. One media query, in CSS, so no listener per
 * row.
 */
const DESKTOP_ONLY = 'hidden [@media(hover:hover)_and_(min-width:641px)]:flex';
const TOUCH_ONLY = '[@media(hover:hover)_and_(min-width:641px)]:hidden';

/**
 * One action on a message. The desktop toolbar and the touch sheet render from the same list:
 * `inMenu` actions sit behind "More" on desktop; on touch every action is a row of the sheet.
 */
type RowAction = {
  id: string;
  label: string;
  icon: ReactNode;
  inMenu?: boolean;
  danger?: boolean;
  /** Only in the touch sheet, not on the desktop toolbar or its "More" menu. */
  touchOnly?: boolean;
  run(): void;
};

const timeFormats = new Map<string, Intl.DateTimeFormat>();
/** `HH:mm` in the viewer's local time and language; one formatter per language. */
export function formatTime(iso: string, language: string): string {
  let format = timeFormats.get(language);
  if (!format) {
    format = new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' });
    timeFormats.set(language, format);
  }
  return format.format(new Date(iso));
}

const toolButton =
  'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground';

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={toolButton}>
      {children}
    </button>
  );
}

function Attachments({ message }: { message: MessageDto }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-start gap-2">
      {message.attachments.map((file) =>
        file.mime.startsWith('image/') ? (
          <ImagePreview
            key={file.id}
            file={file}
            maxWidth={
              file.width && file.height ? Math.min(320, (240 * file.width) / file.height) : 320
            }
          />
        ) : (
          <FileChip key={file.id} file={file} />
        ),
      )}
    </div>
  );
}

function EditForm({
  message,
  groupId,
  onDone,
  onChanged,
}: {
  message: MessageDto;
  groupId: string;
  onDone: () => void;
  onChanged?: (message: MessageDto) => void;
}) {
  return (
    <Composer
      mode="edit"
      groupId={groupId}
      initialBody={message.body}
      hasAttachments={message.attachments.length > 0}
      onCancel={onDone}
      // A rejection stays inside the composer, which shows the error and lets the user retry.
      onSubmit={async ({ body }) => {
        if (body !== message.body) onChanged?.(await editMessage(message.id, body));
        onDone();
      }}
    />
  );
}

function DeleteConfirm({
  message,
  onDone,
  onChanged,
}: {
  message: MessageDto;
  onDone: () => void;
  onChanged?: (message: MessageDto) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function confirm() {
    setBusy(true);
    setFailed(false);
    try {
      await deleteMessage(message.id);
      // The server's own change (a higher seq) replaces this when its event or catch-up arrives.
      onChanged?.({
        ...message,
        deletedAt: new Date().toISOString(),
        changeSeq: message.changeSeq + 1,
        tasks: [],
      });
      onDone();
    } catch {
      setBusy(false);
      setFailed(true);
    }
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2" role="group">
      <span className="text-button font-semibold">{t('chat.confirmDelete')}</span>
      <Button size="sm" variant="destructive" disabled={busy} onClick={() => void confirm()}>
        {t('chat.actions.delete')}
      </Button>
      <Button size="sm" variant="ghost" autoFocus onClick={onDone}>
        {t('chat.cancel')}
      </Button>
      {failed && (
        <span role="alert" className="text-micro text-error-ink">
          {t('errors.generic')}
        </span>
      )}
    </div>
  );
}

/**
 * Touch screens: the "Message actions" button that opens the sheet. Visually hidden (fingers use
 * a long press or a double tap); screen readers and keyboards reach it, and it shows, as the
 * muted "⋯" with a 44 px hit area, while it has the keyboard focus.
 */
function SheetOpener({
  ref,
  label,
  onOpen,
  className,
}: {
  ref: Ref<HTMLButtonElement>;
  label: string;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      onClick={onOpen}
      className={cn(
        "sr-only focus-visible:relative focus-visible:m-0 focus-visible:overflow-visible focus-visible:[clip:auto] focus-visible:[clip-path:none] focus-visible:whitespace-normal focus-visible:inline-flex focus-visible:size-6 focus-visible:items-center focus-visible:justify-center focus-visible:rounded-md focus-visible:text-muted-foreground focus-visible:before:absolute focus-visible:before:-inset-2.5 focus-visible:before:content-['']",
        className,
      )}
    >
      <MoreIcon />
    </button>
  );
}

/**
 * One chat message as a row. Serves top-level messages, thread roots, thread replies and rows
 * still being sent. The hover toolbar sits inside the row (rows use `content-visibility`, which
 * clips overflow); it fades in on hover and focus. Touch screens have no toolbar: a long press or
 * a double tap on the row opens the action sheet.
 */
export const MessageItem = memo(function MessageItem({
  message,
  groupId,
  showHeader,
  mentionsMe,
  inThread = false,
  meId,
  nameOf,
  messageActions,
  renderMessageFooter,
  onReply,
  onOpenThread,
  unreadReplies = false,
  onQuoteClick,
  highlighted = false,
  quote,
  pending,
  failReason,
  onRetry,
  onChanged,
}: MessageItemProps) {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<'view' | 'edit' | 'confirmDelete'>('view');
  const [copied, setCopied] = useState(false);
  const deleted = message.deletedAt !== null;
  const canManage = message.author.id === meId && !deleted && !pending;
  // Unsent rows get no toolbar and no footer: a message that is not saved cannot be turned into
  // a task or carry other actions.
  const showActions = !deleted && !pending && mode === 'view';
  const time = pending ? '' : formatTime(message.createdAt, i18n.language);
  // Phase 28: reactions, optimistic while a tap is on its way.
  const {
    reactions,
    toggle: toggleReaction,
    failed: reactionFailed,
  } = useReactions(message, meId, onChanged);
  const [morePicker, setMorePicker] = useState(false);
  const edited = message.editedAt !== null && !deleted && (
    <span className="text-micro text-muted-foreground">{t('chat.edited')}</span>
  );

  // In order: reply (in a thread: quote), the extra actions (Phase 9), then Edit and Delete.
  const actions: RowAction[] = [];
  if (inThread && onReply) {
    actions.push({
      id: 'quote',
      label: t('chat.actions.quote'),
      icon: <ReplyIcon />,
      run: () => onReply(message),
    });
  } else if (!inThread && onOpenThread) {
    actions.push({
      id: 'thread',
      label: t('chat.actions.replyInThread'),
      icon: <ThreadIcon />,
      run: () => onOpenThread(message),
    });
  }
  // Copy (touch sheet only): a long press opens the sheet instead of selecting text; desktop
  // selects text as usual, so its toolbar stays as it was.
  if (message.body.trim() !== '') {
    actions.push({
      id: 'copy',
      label: t('chat.actions.copy'),
      icon: <CopyIcon />,
      touchOnly: true,
      run: () => {
        // The text as shown (mentions as names); a thread root shown twice has the same text.
        const node = document.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(message.id)}"] [data-message-text]`,
        );
        const text = node?.innerText || node?.textContent || '';
        void navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => undefined,
        );
      },
    });
  }
  for (const action of messageActions ?? []) {
    if (action.isAvailable?.(message) === false) continue;
    actions.push({
      id: action.id,
      label: action.label,
      icon: action.icon,
      inMenu: action.inMenu,
      run: () => action.onSelect(message),
    });
  }
  if (canManage) {
    actions.push(
      {
        id: 'edit',
        label: t('chat.actions.edit'),
        icon: <EditIcon />,
        inMenu: true,
        run: () => setMode('edit'),
      },
      {
        id: 'delete',
        label: t('chat.actions.delete'),
        icon: <TrashIcon />,
        inMenu: true,
        danger: true,
        run: () => setMode('confirmDelete'),
      },
    );
  }
  const desktopActions = actions.filter((a) => !a.touchOnly);
  const menu = desktopActions.filter((a) => a.inMenu);

  // Touch: a long press or a double tap opens the sheet (the hidden "Message actions" button for
  // assistive tech); the focus goes back to that button when it closes.
  const [sheetOpen, setSheetOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const press = useRef<{
    x: number;
    y: number;
    /** The finger moved past the slop: a scroll, so neither a long press nor a tap. */
    moved: boolean;
    timers: ReturnType<typeof setTimeout>[];
  } | null>(null);
  const lastTap = useRef<{ x: number; y: number; at: number } | null>(null);
  const longPressed = useRef(false);
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    opener.current?.focus({ preventScroll: true });
  }, []);
  // The press styles go straight on the row (no re-render per touch): no iOS callout or text
  // selection while the finger is down, and the subtle shrink (`data-pressed`).
  const releasePress = () => {
    const node = rowRef.current;
    if (!node) return;
    node.style.removeProperty('-webkit-touch-callout');
    node.style.removeProperty('-webkit-user-select');
    node.style.removeProperty('user-select');
    delete node.dataset.pressed;
  };
  const cancelTimers = () => {
    press.current?.timers.forEach(clearTimeout);
  };
  const openFromTouch = () => {
    releasePress();
    navigator.vibrate?.(10);
    setSheetOpen(true);
  };
  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!showActions || !touch || event.touches.length > 1) {
      cancelTimers();
      press.current = null;
      releasePress();
      return;
    }
    cancelTimers();
    longPressed.current = false;
    const node = event.currentTarget;
    node.style.setProperty('-webkit-touch-callout', 'none');
    node.style.setProperty('-webkit-user-select', 'none');
    node.style.setProperty('user-select', 'none');
    press.current = {
      x: touch.clientX,
      y: touch.clientY,
      moved: false,
      timers: [
        setTimeout(() => {
          node.dataset.pressed = '';
        }, PRESS_FEEDBACK_MS),
        setTimeout(() => {
          longPressed.current = true;
          lastTap.current = null;
          openFromTouch();
        }, LONG_PRESS_MS),
      ],
    };
  };
  const onTouchMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    const start = press.current;
    if (!start || start.moved || !touch) return;
    if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > LONG_PRESS_SLOP) {
      start.moved = true;
      cancelTimers();
      releasePress();
    }
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = press.current;
    cancelTimers();
    press.current = null;
    releasePress();
    // The finger lifting after a long press must not click whatever is under it (the backdrop).
    if (longPressed.current) {
      longPressed.current = false;
      event.preventDefault();
      return;
    }
    if (!start || start.moved || !showActions) return;
    // A tap on a link, file, image or button keeps its single-tap meaning and is no double tap.
    if ((event.target as Element).closest(OWN_TAP)) {
      lastTap.current = null;
      return;
    }
    const now = Date.now();
    const before = lastTap.current;
    if (
      before &&
      now - before.at < DOUBLE_TAP_MS &&
      Math.hypot(start.x - before.x, start.y - before.y) < DOUBLE_TAP_SLOP
    ) {
      lastTap.current = null;
      // No click from the second tap (it would land on the backdrop) and no zoom.
      event.preventDefault();
      openFromTouch();
      return;
    }
    lastTap.current = { x: start.x, y: start.y, at: now };
  };
  const onTouchCancel = () => {
    cancelTimers();
    press.current = null;
    releasePress();
  };

  return (
    <div
      ref={rowRef}
      data-message-id={message.id}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      // Android opens the link menu on a long press; the sheet replaces it.
      onContextMenu={(event) => {
        if (sheetOpen || longPressed.current || press.current) event.preventDefault();
      }}
      className={cn(
        // The highlight of a linked message eases in and out instead of snapping; a held finger
        // shrinks the row a little (`data-pressed`, 150 ms). `touch-action: manipulation` stops
        // a double tap from zooming the page (pinch zoom still works).
        'group relative flex touch-manipulation gap-3 border-l-2 px-4 pb-1 transition-[background-color,border-color,color,scale] duration-500 data-pressed:scale-[0.98] data-pressed:duration-(--duration-fast)',
        // content-visibility clips overflow: the editing row must show the mention list above it,
        // and a hovered or focused row its toolbar, which sits just above it.
        mode !== 'edit' &&
          '[contain-intrinsic-size:auto_64px] [content-visibility:auto] hover:[content-visibility:visible] focus-within:[content-visibility:visible] has-[[data-state=open]]:[content-visibility:visible]',
        showHeader ? 'pt-3' : 'pt-0.5',
        mentionsMe ? 'border-brand-purple bg-muted' : 'border-transparent',
        (highlighted || sheetOpen) && 'bg-accent',
        pending && 'text-muted-foreground',
      )}
    >
      <div className="w-8 shrink-0">
        {showHeader && <Avatar userId={message.author.id} name={message.author.name} />}
      </div>
      <div className="min-w-0 flex-1">
        {showHeader && (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="min-w-0 text-button font-semibold [overflow-wrap:anywhere]">
              {message.author.name}
            </span>
            {message.author.isAdmin && (
              <span className="self-center rounded-full bg-secondary px-2 text-nano font-semibold text-secondary-foreground">
                {t('chat.egrant')}
              </span>
            )}
            {time && <span className="text-micro text-muted-foreground">{time}</span>}
            {edited}
            {showActions && (
              <SheetOpener
                ref={opener}
                label={t('chat.actions.open')}
                onOpen={() => setSheetOpen(true)}
                className={cn('ml-auto self-center', TOUCH_ONLY)}
              />
            )}
          </div>
        )}
        {!showHeader && showActions && (
          <SheetOpener
            ref={opener}
            label={t('chat.actions.open')}
            onOpen={() => setSheetOpen(true)}
            className={cn(
              'focus-visible:absolute focus-visible:top-0.5 focus-visible:right-3',
              TOUCH_ONLY,
            )}
          />
        )}
        {quote && (
          <button
            type="button"
            onClick={() => onQuoteClick?.(quote.id)}
            className="mb-1 flex max-w-full items-baseline gap-1.5 border-l-2 border-border pl-2 text-left text-micro text-muted-foreground max-[640px]:py-1.5"
          >
            <span className="shrink-0 font-semibold">{quote.author.name}</span>
            <span className="truncate">
              {quote.deletedAt
                ? t('chat.deleted')
                : plainExcerpt(quote.body, nameOf, REPLY_EXCERPT, t('chat.mention.all'))}
            </span>
          </button>
        )}
        {deleted ? (
          <p className="text-body italic text-muted-foreground">{t('chat.deleted')}</p>
        ) : mode === 'edit' ? (
          <EditForm
            message={message}
            groupId={groupId}
            onDone={() => setMode('view')}
            onChanged={onChanged}
          />
        ) : (
          <div className="text-body">
            <div data-message-text="">
              <MessageBody body={message.body} nameOf={nameOf} />
            </div>
            {!showHeader && edited}
          </div>
        )}
        {!deleted && mode !== 'edit' && message.attachments.length > 0 && (
          <Attachments message={message} />
        )}
        {!deleted && mode !== 'edit' && <KnowledgeCards message={message} groupId={groupId} />}
        {!deleted && mode !== 'edit' && <WorkCards message={message} groupId={groupId} />}
        {!deleted && !pending && (
          <ReactionChips
            message={message}
            reactions={reactions}
            meId={meId}
            onToggle={toggleReaction}
            failed={reactionFailed}
          />
        )}
        {mode === 'confirmDelete' && (
          <DeleteConfirm message={message} onDone={() => setMode('view')} onChanged={onChanged} />
        )}
        {pending === 'failed' && (
          <p className="mt-0.5 text-micro text-error-ink">
            {failReason === 'invalid_mention'
              ? t('chat.composer.mentionNotAllowed')
              : t('chat.notSent')}{' '}
            <button
              type="button"
              // A 44 px tap area around the short word.
              className="relative font-semibold underline underline-offset-2 after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-['']"
              onClick={() => message.clientId && onRetry?.(message.clientId)}
            >
              {t('chat.retry')}
            </button>
          </p>
        )}
        {!inThread && message.replyCount > 0 && onOpenThread && (
          <button
            type="button"
            onClick={() => onOpenThread(message)}
            data-thread-link=""
            className="mt-1 flex items-center gap-1.5 text-left text-micro font-semibold text-brand-purple underline-offset-2 hover:underline max-[640px]:-my-1.5 max-[640px]:min-h-11"
          >
            {unreadReplies && (
              <>
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-brand-purple" />
                <span className="sr-only">{t('chat.thread.unreadReplies')}</span>
              </>
            )}
            {t('chat.thread.summary', {
              count: message.replyCount,
              time: message.lastReplyAt ? formatTime(message.lastReplyAt, i18n.language) : '',
            })}
          </button>
        )}
        {!deleted && !pending && renderMessageFooter?.(message)}
      </div>
      {showActions && (
        <div
          role="toolbar"
          aria-label={t('chat.actions.label')}
          className={cn(
            // Just above the message (4px overlap into its top padding), never over the name or time. The scroll containers reserve pt-9 for it.
            'absolute right-3 bottom-full z-10 translate-y-1 items-center rounded-lg border border-border bg-card p-0.5 opacity-0',
            'group-focus-within:opacity-100 group-hover:opacity-100 has-[[data-state=open]]:opacity-100',
            DESKTOP_ONLY,
          )}
        >
          <ReactionMenu
            reactions={reactions}
            meId={meId}
            onPick={toggleReaction}
            buttonClassName={toolButton}
            icon={<AddReactionIcon />}
          />
          {desktopActions
            .filter((a) => !a.inMenu)
            .map((action) => (
              <ToolButton key={action.id} label={action.label} onClick={action.run}>
                {action.icon}
              </ToolButton>
            ))}
          {menu.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t('chat.actions.more')}
                  title={t('chat.actions.more')}
                  className={toolButton}
                >
                  <MoreIcon />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
                {menu.map((action) => (
                  <DropdownMenuItem
                    key={action.id}
                    variant={action.danger ? 'destructive' : undefined}
                    onSelect={action.run}
                  >
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      <ActionSheet open={sheetOpen} label={t('chat.actions.open')} onClose={closeSheet}>
        <QuickReactions
          reactions={reactions}
          meId={meId}
          className="mb-1 justify-between border-b border-border px-1 pb-2"
          onPick={(emoji) => {
            setSheetOpen(false);
            toggleReaction(emoji);
          }}
          onMore={() => {
            setSheetOpen(false);
            setMorePicker(true);
          }}
        />
        {actions.map((action) => (
          <ActionSheetItem
            key={action.id}
            icon={action.icon}
            label={action.label}
            danger={action.danger}
            onSelect={() => {
              setSheetOpen(false);
              action.run();
            }}
          />
        ))}
      </ActionSheet>
      <MorePicker
        open={morePicker}
        onPick={(emoji) => {
          setMorePicker(false);
          toggleReaction(emoji, true);
        }}
        onClose={() => setMorePicker(false)}
      />
      {copied && <Toast onClose={() => setCopied(false)}>{t('chat.copied')}</Toast>}
    </div>
  );
});
