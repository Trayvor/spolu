import { memo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { plainExcerpt, type MessageDto } from '@spolu/shared';
import { Avatar } from '@/components/avatar';
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
import { Composer } from './composer';
import { MessageBody } from './format/render';
import { MoreIcon, ReplyIcon, ThreadIcon } from './icons';

/** An extra entry in the hover toolbar of every message (Phase 9 adds "Turn into tasks"). */
export type MessageAction = {
  id: string;
  label: string;
  icon: ReactNode;
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
  onQuoteClick?: (messageId: string) => void;
  highlighted?: boolean;
  /** The message this one replies to (thread replies only). */
  quote?: MessageDto | null;
  /** A message still being sent (`sending`) or that failed; it has no actions. */
  pending?: 'sending' | 'failed';
  onRetry?: (clientId: string) => void;
  /** The server answered an edit (the updated message) or a delete (the message marked deleted). Apply it to the window only: it must not move lastSeq or catch-up bookkeeping (a delete copy has a fabricated changeSeq and deletedAt). */
  onChanged?: (message: MessageDto) => void;
}

const REPLY_EXCERPT = 80;

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
  onQuoteClick,
  highlighted = false,
  quote,
  pending,
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

  const reply = inThread
    ? onReply && { label: t('chat.actions.reply'), icon: <ReplyIcon />, run: onReply }
    : onOpenThread && {
        label: t('chat.actions.replyInThread'),
        icon: <ThreadIcon />,
        run: onOpenThread,
      };

  return (
    <div
      data-message-id={message.id}
      className={cn(
        'group relative flex gap-3 border-l-2 px-4 pb-1',
        // content-visibility clips overflow: the editing row must show the mention list above it.
        mode !== 'edit' && '[contain-intrinsic-size:auto_64px] [content-visibility:auto]',
        showHeader ? 'pt-3' : 'pt-0.5',
        mentionsMe ? 'border-brand-purple bg-muted' : 'border-transparent',
        highlighted && 'bg-accent',
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
          </div>
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
            {t('chat.notSent')}{' '}
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
            className="mt-1 block text-micro font-semibold text-brand-purple underline-offset-2 hover:underline"
          >
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
          className={cn(
            'absolute right-3 top-1 flex items-center rounded-lg border border-border bg-card p-0.5 opacity-0',
            'group-focus-within:opacity-100 group-hover:opacity-100 has-[[data-state=open]]:opacity-100',
            '[@media(pointer:coarse)]:opacity-100',
          )}
        >
          {reply && (
            <ToolButton label={reply.label} onClick={() => reply.run(message)}>
              {reply.icon}
            </ToolButton>
          )}
          {messageActions?.map((action) => (
            <ToolButton
              key={action.id}
              label={action.label}
              onClick={() => action.onSelect(message)}
            >
              {action.icon}
            </ToolButton>
          ))}
          {canManage && (
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
                <DropdownMenuItem onSelect={() => setMode('edit')}>
                  {t('chat.actions.edit')}
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => setMode('confirmDelete')}>
                  {t('chat.actions.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  );
});
