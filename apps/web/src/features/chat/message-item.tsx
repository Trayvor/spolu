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
import { EditIcon, MoreIcon, ReplyIcon, ThreadIcon, TrashIcon } from './icons';

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
/** Moving the finger further than this (px) is a scroll, not a long press. */
const LONG_PRESS_SLOP = 10;

/**
 * Desktop (a pointer that hovers, 641 px and wider) shows the hover toolbar; everything else
 * shows the "⋯" button and the action sheet. One media query, in CSS, so no listener per row.
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

/** Touch screens: the muted "⋯" that opens a message's action sheet; a 44 px hit area. */
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
        "relative inline-flex size-6 items-center justify-center rounded-md text-muted-foreground before:absolute before:-inset-2.5 before:content-['']",
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
 * clips overflow); it fades in on hover and focus and stays visible on touch screens.
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
  const deleted = message.deletedAt !== null;
  const canManage = message.author.id === meId && !deleted && !pending;
  // Unsent rows get no toolbar and no footer: a message that is not saved cannot be turned into
  // a task or carry other actions.
  const showActions = !deleted && !pending && mode === 'view';
  const time = pending ? '' : formatTime(message.createdAt, i18n.language);
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
  const menu = actions.filter((a) => a.inMenu);

  // Touch: "⋯" or a long press opens the sheet; the focus goes back to "⋯" when it closes.
  const [sheetOpen, setSheetOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const longPressed = useRef(false);
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    opener.current?.focus();
  }, []);
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (!showActions || !touch || event.touches.length > 1) return;
    cancelPress();
    longPressed.current = false;
    press.current = {
      x: touch.clientX,
      y: touch.clientY,
      timer: setTimeout(() => {
        press.current = null;
        longPressed.current = true;
        setSheetOpen(true);
      }, LONG_PRESS_MS),
    };
  };
  const onTouchMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    const start = press.current;
    if (!start || !touch) return;
    if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > LONG_PRESS_SLOP) {
      cancelPress();
    }
  };
  const onTouchEnd = (event: TouchEvent) => {
    cancelPress();
    // The finger lifting after a long press must not click whatever is under it (the backdrop).
    if (longPressed.current) {
      longPressed.current = false;
      event.preventDefault();
    }
  };

  return (
    <div
      data-message-id={message.id}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={cancelPress}
      // Android opens the link menu on a long press; the sheet replaces it.
      onContextMenu={(event) => {
        if (sheetOpen || longPressed.current) event.preventDefault();
      }}
      className={cn(
        'group relative flex gap-3 border-l-2 px-4 pb-1',
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
            <span className="text-button font-semibold">{message.author.name}</span>
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
            className={cn('absolute top-0.5 right-3', TOUCH_ONLY)}
          />
        )}
        {quote && (
          <button
            type="button"
            onClick={() => onQuoteClick?.(quote.id)}
            className="mb-1 flex max-w-full items-baseline gap-1.5 border-l-2 border-border pl-2 text-left text-micro text-muted-foreground"
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
            <MessageBody body={message.body} nameOf={nameOf} />
            {!showHeader && edited}
          </div>
        )}
        {!deleted && mode !== 'edit' && message.attachments.length > 0 && (
          <Attachments message={message} />
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
              className="font-semibold underline underline-offset-2"
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
            className="mt-1 flex items-center gap-1.5 text-left text-micro font-semibold text-brand-purple underline-offset-2 hover:underline"
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
          {actions
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
    </div>
  );
});
