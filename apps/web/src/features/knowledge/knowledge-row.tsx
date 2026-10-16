import type { KnowledgeSummary } from '@spolu/shared';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { Avatar } from '@/components/avatar';
import { PaperclipIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { formatFileSize } from '@/features/files/format-size';
import { fileUrl } from '@/features/files/urls';
import { formatReminderTime } from '@/features/reminders/format';
import { formatCreated } from '@/features/tasks/dates';
import { CalendarLeaf } from './calendar-leaf';
import { ChatSourceLabel, chatSourceLocation } from './chat-source';
import {
  ArrowOutIcon,
  BellIcon,
  ChatFileIcon,
  FileIcon,
  LinkIcon,
  LockIcon,
  NoteIcon,
  SmallFolderIcon,
} from './icons';

/** The URL without its protocol and a leading `www.`. */
export const displayUrl = (url: string): string =>
  url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');

const linkClass = 'pointer-events-auto font-semibold underline hover:text-neutral';

const TILE_ICONS = {
  note: NoteIcon,
  file: FileIcon,
  link: LinkIcon,
  chat_file: ChatFileIcon,
} as const;

const overlayClass =
  'absolute inset-0 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';

function Tile({ item, done }: { item: KnowledgeSummary; done: boolean }) {
  if (item.type === 'reminder') {
    const iso = done ? item.lastReminderAt : item.nextReminderAt;
    if (iso) {
      return (
        <>
          <span className="sm:hidden">
            <CalendarLeaf iso={iso} muted={done} size={32} />
          </span>
          <span className="hidden sm:block">
            <CalendarLeaf iso={iso} muted={done} size={40} />
          </span>
        </>
      );
    }
  }
  const Glyph = item.type === 'reminder' ? BellIcon : TILE_ICONS[item.type];
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground sm:size-10"
    >
      <Glyph />
    </span>
  );
}

/**
 * One list row. The row is a div: a full-row button underneath opens the detail (for a chat
 * file, a full-row link opens the chat at its message), and the inner links are siblings of it
 * (never nested in it) with pointer events of their own.
 */
export function KnowledgeRow({
  item,
  onOpen,
  showGroup,
  showPath,
}: {
  item: KnowledgeSummary;
  onOpen: (id: string) => void;
  showGroup?: boolean;
  /** A search result: the item's folder path, when it is in a folder. */
  showPath?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const done = item.type === 'reminder' && item.nextReminderAt === null;
  // The server cuts the excerpt at 140 characters; a full-length one was probably cut.
  const excerpt =
    item.excerpt.length >= 140 && !item.excerpt.endsWith('…') ? `${item.excerpt}…` : item.excerpt;

  return (
    <div className="relative flex gap-4 px-4 py-4 hover:bg-muted/50 sm:px-5">
      {item.type === 'chat_file' && item.chat ? (
        <Link
          {...chatSourceLocation(item.groupId, item.chat)}
          aria-label={t('knowledge.chat.open', { title: item.title })}
          className={overlayClass}
        />
      ) : (
        <button
          type="button"
          aria-label={t('knowledge.row.open', { title: item.title })}
          onClick={() => onOpen(item.id)}
          className={overlayClass}
        />
      )}
      <div className="pointer-events-none relative flex min-w-0 flex-1 gap-4">
        <Tile item={item} done={done} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            {item.type === 'chat_file' && item.file ? (
              // The title is the file name: it downloads the file (or opens an image).
              <a
                href={fileUrl(item.file.id)}
                className="pointer-events-auto min-w-0 truncate text-button font-semibold underline hover:text-neutral"
              >
                {item.title}
              </a>
            ) : (
              <span className="min-w-0 flex-1 truncate text-button font-semibold">
                {item.title}
              </span>
            )}
            {item.type === 'chat_file' && <span className="flex-1" />}
            {item.visibility === 'admins' && (
              <Badge variant="outline">
                <LockIcon />
                {t('knowledge.visibility.admins')}
              </Badge>
            )}
            {item.type === 'note' && item.fileCount > 0 && (
              <span
                role="img"
                className="flex shrink-0 items-center gap-1 text-micro text-muted-foreground"
                aria-label={t('knowledge.row.files', { count: item.fileCount })}
              >
                <PaperclipIcon />
                {item.fileCount}
              </span>
            )}
          </div>
          {item.type === 'note' && excerpt && (
            <p className="truncate text-button text-muted-foreground">{excerpt}</p>
          )}
          {item.type === 'chat_file' && item.chat && (
            <p className="flex min-w-0 items-center gap-2 text-button text-muted-foreground">
              <ChatSourceLabel chat={item.chat} />
              {item.file && (
                <span className="shrink-0">{formatFileSize(item.file.size, i18n.language)}</span>
              )}
            </p>
          )}
          {item.type === 'file' && item.file && (
            <p className="flex min-w-0 items-baseline gap-2 text-button">
              <a href={fileUrl(item.file.id)} className={`${linkClass} min-w-0 truncate`}>
                {item.file.name}
              </a>
              <span className="shrink-0 text-muted-foreground">
                {formatFileSize(item.file.size, i18n.language)}
              </span>
            </p>
          )}
          {item.type === 'link' && item.url && (
            <p className="flex min-w-0 items-center gap-1 text-button">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`${linkClass} min-w-0 truncate`}
              >
                {displayUrl(item.url)}
              </a>
              <ArrowOutIcon />
            </p>
          )}
          {item.type === 'reminder' && (
            <p className="truncate text-button">
              {done ? (
                <span className="text-muted-foreground">{t('knowledge.row.done')}</span>
              ) : (
                <>
                  {formatReminderTime(item.nextReminderAt!, i18n.language)}
                  {item.upcomingCount > 1 && (
                    <span className="text-muted-foreground">
                      {' '}
                      {t('knowledge.row.moreTimes', { count: item.upcomingCount - 1 })}
                    </span>
                  )}
                </>
              )}
            </p>
          )}
          {item.type !== 'note' && item.type !== 'chat_file' && excerpt && (
            <p className="truncate text-button text-muted-foreground">{excerpt}</p>
          )}
          <div className="mt-1 flex min-w-0 items-center gap-2 text-micro text-muted-foreground">
            {showGroup && item.group && (
              <>
                {item.group.logoUrl ? (
                  <img src={item.group.logoUrl} alt="" className="size-6 shrink-0 rounded-full" />
                ) : (
                  <Avatar userId={item.group.id} name={item.group.name} size={24} />
                )}
                <span className="truncate font-semibold">{item.group.name}</span>
              </>
            )}
            {showPath && item.folderPath.length > 0 && (
              <span
                className="flex min-w-0 items-center gap-1"
                aria-label={t('knowledge.folders.path')}
              >
                <SmallFolderIcon />
                <span className="truncate">{item.folderPath.map((f) => f.name).join(' / ')}</span>
              </span>
            )}
            <Avatar userId={item.createdBy.id} name={item.createdBy.name} size={24} />
            <span className="truncate">{item.createdBy.name}</span>
            <span className="shrink-0">{formatCreated(item.createdAt, i18n.language)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
