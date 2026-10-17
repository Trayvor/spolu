import type { KnowledgeSummary } from '@spolu/shared';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/avatar';
import { PaperclipIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { fileUrl } from '@/features/files/urls';
import { formatCreated } from '@/features/tasks/dates';
import { LockIcon, SmallFolderIcon } from './icons';
import { ItemOverlay, Tile, TypeLine } from './knowledge-row';

/**
 * One item of the card view (owner request of 2026-10-17): the row's facts plus several lines of
 * the body. Like the row, a button (a chat file: a link) laid over the whole card opens it, and
 * the inner links are its siblings with pointer events of their own. The folder path shows when
 * `showPath` (search results), the group when `showGroup` (the global list).
 */
export function KnowledgeCard({
  item,
  onOpen,
  showGroup,
  showPath,
}: {
  item: KnowledgeSummary;
  onOpen: (id: string) => void;
  showGroup?: boolean;
  showPath?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const done = item.type === 'reminder' && item.nextReminderAt === null;
  return (
    <div className="relative flex h-full flex-col rounded-xl bg-card p-4 text-card-foreground hover:bg-muted/50 sm:p-5">
      <ItemOverlay item={item} onOpen={onOpen} />
      <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Tile item={item} done={done} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {item.type === 'chat_file' && item.file ? (
              <a
                href={fileUrl(item.file.id)}
                className="pointer-events-auto line-clamp-2 self-start text-button font-semibold break-words underline hover:text-neutral"
              >
                {item.title}
              </a>
            ) : (
              <span className="line-clamp-2 text-button font-semibold break-words">
                {item.title}
              </span>
            )}
            <TypeLine item={item} />
          </div>
          {item.visibility === 'admins' && (
            <Badge variant="outline" className="shrink-0">
              <LockIcon />
              {t('knowledge.visibility.admins')}
            </Badge>
          )}
        </div>
        {item.excerpt && (
          // The server keeps the body's lines (plain text, "…" when cut); five of them show.
          <p
            data-slot="card-excerpt"
            className="line-clamp-5 text-button leading-relaxed break-words whitespace-pre-line text-muted-foreground"
          >
            {item.excerpt}
          </p>
        )}
        <div className="mt-auto flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-micro text-muted-foreground">
          {showGroup && item.group && (
            <span className="flex min-w-0 basis-full items-center gap-2">
              {item.group.logoUrl ? (
                <img src={item.group.logoUrl} alt="" className="size-6 shrink-0 rounded-full" />
              ) : (
                <Avatar userId={item.group.id} name={item.group.name} size={24} />
              )}
              <span className="truncate font-semibold">{item.group.name}</span>
            </span>
          )}
          {showPath && item.folderPath.length > 0 && (
            <span
              className="flex min-w-0 basis-full items-center gap-1"
              aria-label={t('knowledge.folders.path')}
            >
              <SmallFolderIcon />
              <span className="truncate">{item.folderPath.map((f) => f.name).join(' / ')}</span>
            </span>
          )}
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <Avatar userId={item.createdBy.id} name={item.createdBy.name} size={24} />
            <span className="truncate">{item.createdBy.name}</span>
            <span className="shrink-0">{formatCreated(item.createdAt, i18n.language)}</span>
          </span>
          {item.type === 'note' && item.fileCount > 0 && (
            <span
              role="img"
              className="flex shrink-0 items-center gap-1"
              aria-label={t('knowledge.row.files', { count: item.fileCount })}
            >
              <PaperclipIcon />
              {item.fileCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
