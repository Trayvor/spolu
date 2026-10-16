import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { BucketKind, TaskChatSummary, TaskDto, TaskPerson } from '@spolu/shared';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDue, isOverdue } from './dates';
import { DoneCircle } from './done-circle';
import { BellIcon, ChatIcon, LinkIcon, PaperclipIcon } from './icons';

const MAX_AVATARS = 3;

/**
 * The card's meta row: up to three overlapping avatars with "+n", the due date (error ink when
 * overdue) and, pushed right, a link icon when the task has a link, a bell when the task has
 * upcoming custom reminders, a paperclip with
 * the file count and a chat bubble with the message count (a dot on the bubble when the chat is
 * unread). Shared by the board card and the
 * AI review's card summaries.
 */
export function TaskCardMeta({
  assignees,
  dueDate,
  overdue,
  fileCount,
  chat,
  hasReminders = false,
  hasLink = false,
}: {
  assignees: TaskPerson[];
  dueDate: string | null;
  overdue: boolean;
  fileCount: number;
  chat?: TaskChatSummary;
  /** Upcoming custom reminders (no count, to keep the card quiet). */
  hasReminders?: boolean;
  /** The task has a link (no URL on the card: it opens from the panel). */
  hasLink?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const hasChat = chat !== undefined && chat.count > 0;
  const shown = assignees.slice(0, MAX_AVATARS);
  const extra = assignees.length - shown.length;
  return (
    <span className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-micro text-muted-foreground">
      {shown.length > 0 && (
        <span className="flex items-center">
          {shown.map((person) => (
            <Avatar
              key={person.id}
              userId={person.id}
              name={person.name}
              size={24}
              className="-ml-1.5 border-2 border-card first:ml-0"
            />
          ))}
          {extra > 0 && (
            <span className="ml-1 font-semibold">
              {t('tasks.card.moreAssignees', { count: extra })}
            </span>
          )}
          <span className="sr-only">{assignees.map((p) => p.name).join(', ')}</span>
        </span>
      )}
      {dueDate && (
        <time
          dateTime={dueDate}
          className={cn(overdue && 'font-semibold text-error-ink')}
          title={t('tasks.card.due', { date: formatDue(dueDate, i18n.language) })}
        >
          {formatDue(dueDate, i18n.language)}
          {overdue && <span className="sr-only"> ({t('tasks.card.overdue')})</span>}
        </time>
      )}
      {(fileCount > 0 || hasChat || hasReminders || hasLink) && (
        <span className="ml-auto flex items-center gap-3">
          {hasLink && (
            <span className="flex items-center">
              <LinkIcon />
              <span className="sr-only">{t('tasks.card.link')}</span>
            </span>
          )}
          {hasReminders && (
            <span className="flex items-center">
              <BellIcon />
              <span className="sr-only">{t('tasks.card.reminders')}</span>
            </span>
          )}
          {fileCount > 0 && (
            <span className="flex items-center gap-1">
              <PaperclipIcon />
              <span aria-hidden="true">{fileCount}</span>
              <span className="sr-only">{t('tasks.card.files', { count: fileCount })}</span>
            </span>
          )}
          {chat && hasChat && (
            <span className={cn('flex items-center gap-1', chat.unread && 'text-foreground')}>
              <ChatIcon unread={chat.unread} />
              <span aria-hidden="true">{chat.count}</span>
              <span className="sr-only">
                {t(chat.unread ? 'tasks.card.messagesUnread' : 'tasks.card.messages', {
                  count: chat.count,
                })}
              </span>
            </span>
          )}
        </span>
      )}
    </span>
  );
}

/**
 * One card on the board: a link to the task panel. Presentational only (no hooks besides i18n):
 * the board's drag layer passes its handle props and ref in, the card itself knows no dnd-kit.
 */
export function TaskCard({
  task,
  bucketKind,
  today,
  ref,
  handleProps,
  lifted,
  onToggleDone,
  chat,
  groupLine,
  link,
  showDone = true,
}: {
  task: TaskDto;
  bucketKind: BucketKind;
  /** Today's date in Bratislava (`YYYY-MM-DD`), passed down so a board renders one clock. */
  today: string;
  ref?: Ref<HTMLAnchorElement>;
  /** Drag listeners and `aria-describedby` (the drag instructions); the card stays a link. */
  handleProps?: HTMLAttributes<HTMLAnchorElement>;
  /** Set on the copy that follows the pointer or the arrow keys while the card is dragged. */
  lifted?: 'pointer' | 'keyboard';
  /** The done circle was pressed. */
  onToggleDone?: () => void;
  /** The task chat's message count and unread flag; absent when it has no messages. */
  chat?: TaskChatSummary;
  /** Rendered first in the card: the global board's client line (Phase 20). */
  groupLine?: ReactNode;
  /** Where the card goes; default the task panel over the group's board. */
  link?: { to: string; search?: Record<string, unknown>; params?: Record<string, string> };
  /** The done circle (the global board has none: a task is moved from its panel). */
  showDone?: boolean;
}) {
  const { t } = useTranslation();
  const overdue = isOverdue(task.dueDate, bucketKind, today);
  const done = bucketKind === 'done';
  const titleId = `task-title-${task.id}`;
  const hasMeta =
    task.assignees.length > 0 ||
    task.dueDate !== null ||
    task.fileCount > 0 ||
    task.upcomingReminders > 0 ||
    task.link !== null ||
    (chat?.count ?? 0) > 0;

  // The circle is a sibling of the link (no button inside a link), laid over its left padding
  // on the title's line: 12 px padding, plus the Urgent pill (24 px) and the 8 px gap above it.
  return (
    <div className="relative">
      <Link
        {...(link
          ? { to: link.to as never, params: link.params as never, search: link.search as never }
          : {
              to: '/groups/$groupId/tasks/$taskId',
              params: { groupId: task.groupId, taskId: task.id },
            })}
        ref={ref}
        {...handleProps}
        // The lifted copy is only a picture of the card: out of the tab order.
        tabIndex={lifted ? -1 : undefined}
        className={cn(
          // No callout, text selection or double-tap zoom on a long press: on touch it drags.
          'flex touch-manipulation select-none flex-col items-start gap-2 rounded-lg bg-card p-3 text-left [-webkit-touch-callout:none]',
          showDone && 'pl-10',
          lifted && 'cursor-grabbing shadow-lift',
          // A card picked up with the keyboard keeps the focus ring on its lifted copy.
          lifted === 'keyboard' && 'outline-2 outline-offset-3 outline-ring',
        )}
      >
        {groupLine}
        {task.urgent && <Badge variant="destructive">{t('tasks.card.urgent')}</Badge>}
        <span
          id={lifted ? undefined : titleId}
          className={cn(
            'line-clamp-3 break-words text-button',
            chat?.unread ? 'font-bold' : 'font-medium',
            done && 'text-muted-foreground line-through',
          )}
        >
          {task.title}
        </span>
        {hasMeta && (
          <TaskCardMeta
            assignees={task.assignees}
            dueDate={task.dueDate}
            overdue={overdue}
            fileCount={task.fileCount}
            chat={chat}
            hasReminders={task.upcomingReminders > 0}
            hasLink={task.link !== null}
          />
        )}
      </Link>
      {showDone && (
        <DoneCircle
          done={done}
          onToggle={onToggleDone}
          inert={lifted !== undefined}
          describedBy={titleId}
          className={cn('absolute left-3', task.urgent ? 'top-11' : 'top-3')}
        />
      )}
    </div>
  );
}
