import { isAutoFileType, type KnowledgeSummary, type SessionUser } from '@spolu/shared';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { MoreIcon } from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { isAdmin } from '@/features/auth/roles';
import { chatSourceLocation } from './chat-source';
import { originLocation } from './origin-source';

/**
 * Whether `me` may save an automatic file as a file item, as the server's `canConvertFile`: its
 * author, admins and the group's managers (2026-10-23). A list only holds items `me` reads, and a
 * client reads a group's knowledge only as its manager (a ziadatel reads none), so every reader
 * qualifies. The server checks again.
 */
export const mayConvert = (me: SessionUser | null, item: KnowledgeSummary): boolean =>
  me !== null &&
  isAutoFileType(item.type) &&
  (isAdmin(me) || item.createdBy.id === me.id || me.role === 'client');

/** The router location of an automatic file's source: the chat message, the ticket or the task. */
export function sourceLocation(item: KnowledgeSummary) {
  if (item.chat) return chatSourceLocation(item.groupId, item.chat);
  if (item.origin) return originLocation(item.groupId, item.origin);
  return null;
}

/** "Show in chat", "Show ticket" or "Show task". */
export function sourceShowKey(item: KnowledgeSummary): string {
  if (item.origin) {
    return item.origin.kind === 'ticket'
      ? 'knowledge.origin.showTicket'
      : 'knowledge.origin.showTask';
  }
  return 'knowledge.chat.show';
}

/**
 * The "…" menu of an automatic file's row or card (2026-10-22): "Save as a file" (`onConvert`,
 * given only to its author, admins and the group's managers: `mayConvert`), the way to its source
 * and the detail. The row itself opens the source, so these were out of reach before.
 */
export function AutoFileMenu({
  item,
  onOpen,
  onConvert,
}: {
  item: KnowledgeSummary;
  onOpen: (id: string) => void;
  onConvert?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const location = sourceLocation(item);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('knowledge.row.actions', { title: item.title })}
        className="pointer-events-auto flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring touch:size-11"
      >
        <MoreIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onConvert && (
          <DropdownMenuItem onSelect={() => onConvert(item.id)}>
            {t('knowledge.chat.toFile')}
          </DropdownMenuItem>
        )}
        {location && (
          <DropdownMenuItem asChild>
            <Link {...location}>{t(sourceShowKey(item))}</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => onOpen(item.id)}>
          {t('knowledge.row.details')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
