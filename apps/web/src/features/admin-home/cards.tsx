import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AssignedTask, HomeReminder, MentionItem } from '@spolu/shared';
import { Badge } from '@/components/ui/badge';
import { formatDue, isOverdue, todayInBratislava } from '@/features/tasks/dates';
import { cn } from '@/lib/utils';
import { assignedQuery, mentionsQuery, remindersQuery } from './api';
import type { CardTarget, CountCardProps } from './count-card';

const stateOf = (query: UseQueryResult<unknown>): CountCardProps['state'] =>
  query.isPending ? 'loading' : query.isError ? 'error' : 'ready';

const locale = (language: string) => (/^en\b/.test(language) ? 'en-GB' : language);

const taskTarget = (groupId: string, taskId: string): CardTarget => ({
  to: '/groups/$groupId/tasks/$taskId',
  params: { groupId, taskId },
});

/**
 * The chat link of a mention: the group chat, the task's Chat tab or the ticket page (Phase 21),
 * at the message (and thread).
 */
export function mentionTarget(item: MentionItem): CardTarget {
  const at = {
    ...(item.parentId ? { thread: item.parentId } : {}),
    message: item.messageId,
    c: item.channelId,
  };
  if (item.ticketId) {
    return { to: '/tickets/$ticketId', params: { ticketId: item.ticketId }, search: at };
  }
  return item.taskId
    ? {
        to: '/groups/$groupId/tasks/$taskId',
        params: { groupId: item.groupId, taskId: item.taskId },
        search: { tab: 'chat', ...at },
      }
    : { to: '/groups/$groupId/chat', params: { groupId: item.groupId }, search: at };
}

export function reminderTarget(item: HomeReminder): CardTarget {
  return item.target.kind === 'task'
    ? taskTarget(item.groupId, item.target.taskId)
    : {
        to: '/groups/$groupId/knowledge',
        params: { groupId: item.groupId },
        search: { k: item.target.itemId },
      };
}

function AssignedRow({ task, today }: { task: AssignedTask; today: string }) {
  const { t, i18n } = useTranslation();
  const overdue = isOverdue(task.dueDate, task.bucketKind, today);
  return (
    <>
      {task.urgent && <Badge variant="destructive">{t('adminHome.cards.urgent')}</Badge>}
      <span className="min-w-0 flex-1 truncate text-button font-semibold">{task.title}</span>
      <span className="hidden max-w-[40%] truncate text-micro text-muted-foreground min-[641px]:inline">
        {task.groupName}
      </span>
      <span
        className={cn(
          'shrink-0 text-micro tabular-nums',
          task.dueDate === null
            ? 'text-muted-foreground'
            : overdue
              ? 'font-semibold text-error-ink'
              : 'text-foreground',
        )}
      >
        {task.dueDate === null
          ? t('adminHome.cards.assigned.noDate')
          : formatDue(task.dueDate, i18n.language)}
      </span>
    </>
  );
}

export function useAssignedCard(): CountCardProps {
  const { t } = useTranslation();
  const query = useQuery(assignedQuery);
  const today = todayInBratislava();
  const data = query.data;
  return {
    title: t('adminHome.cards.assigned.title'),
    count: data?.total ?? 0,
    caption: t('adminHome.cards.assigned.caption'),
    subline: (
      <span className="flex items-center gap-1.5 text-micro text-muted-foreground">
        {(data?.urgent ?? 0) > 0 && (
          <span aria-hidden="true" className="size-2 rounded-full bg-destructive" />
        )}
        {t('adminHome.cards.assigned.urgent', { count: data?.urgent ?? 0 })}
      </span>
    ),
    rows: (data?.items ?? []).map((task) => ({
      key: task.id,
      to: taskTarget(task.groupId, task.id),
      content: <AssignedRow task={task} today={today} />,
    })),
    empty: t('adminHome.cards.assigned.empty'),
    showAll:
      data && data.total > data.items.length
        ? {
            label: t('adminHome.cards.assigned.showAll', { count: data.total }),
            to: {
              to: '/tasks',
              // `all`: every client, without sending hundreds of ids.
              search: { assignee: 'me', clients: 'all' },
            },
          }
        : undefined,
    state: stateOf(query),
    onRetry: () => void query.refetch(),
  };
}

/** The reminders card, or null when there is no reminder source (the card is not shown). */
export function useRemindersCard(): CountCardProps | null | undefined {
  const { t, i18n } = useTranslation();
  const query = useQuery(remindersQuery);
  if (query.data && !query.data.available) return null;
  const data = query.data?.available ? query.data : undefined;
  const when = new Intl.DateTimeFormat(locale(i18n.language), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Bratislava',
  });
  return {
    title: t('adminHome.cards.reminders.title'),
    count: data?.nextWeek ?? 0,
    caption: t('adminHome.cards.reminders.caption'),
    rows: (data?.items ?? []).map((item) => ({
      key: item.id,
      to: reminderTarget(item),
      tall: true,
      content: (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-micro text-muted-foreground tabular-nums">
            {when.format(new Date(item.at))} · {item.groupName}
          </span>
          <span className="truncate text-button font-semibold">{item.title}</span>
        </span>
      ),
    })),
    empty: t('adminHome.cards.reminders.empty'),
    state: query.isError || data?.error ? 'error' : stateOf(query),
    onRetry: () => void query.refetch(),
  };
}

export function useMentionsCard(): CountCardProps {
  const { t } = useTranslation();
  const query = useQuery(mentionsQuery);
  const data = query.data;
  return {
    title: t('adminHome.cards.mentions.title'),
    count: data?.total ?? 0,
    caption: t('adminHome.cards.mentions.caption'),
    rows: (data?.items ?? []).map((item) => ({
      key: item.messageId,
      to: mentionTarget(item),
      tall: true,
      content: (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-micro text-muted-foreground">
            <span className="font-semibold text-foreground">{item.authorName}</span> ·{' '}
            {item.groupName}
          </span>
          <span className="truncate text-button">{item.excerpt}</span>
        </span>
      ),
    })),
    empty: t('adminHome.cards.mentions.empty'),
    state: stateOf(query),
    onRetry: () => void query.refetch(),
  };
}
