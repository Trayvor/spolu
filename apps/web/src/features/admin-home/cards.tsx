import type { ReactNode } from 'react';
import { UnseenMarker } from '@/features/unseen/marker';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  AssignedTask,
  HomeMeeting,
  HomeReminder,
  HomeTicket,
  MentionItem,
  TimeRequest,
} from '@spolu/shared';
import { Badge } from '@/components/ui/badge';
import { formatDue, isOverdue, todayInBratislava } from '@/features/tasks/dates';
import { askForTime } from '@/features/tasks/time-queue';
import { cn } from '@/lib/utils';
import { assignedQuery, meetingsQuery, mentionsQuery, remindersQuery, ticketsQuery } from './api';
import type { CardTarget, CountCardProps } from './count-card';

const stateOf = (query: UseQueryResult<unknown>): CountCardProps['state'] =>
  query.isPending ? 'loading' : query.isError ? 'error' : 'ready';

const locale = (language: string) => (/^en\b/.test(language) ? 'en-GB' : language);

/** `YYYY-MM-DD` plus `days` (calendar days; the strings are Bratislava dates). */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The phone sheet's task groups, in this order. */
export type TaskGroup = 'overdue' | 'today' | 'week' | 'later' | 'noDate';
export const TASK_GROUPS: TaskGroup[] = ['overdue', 'today', 'week', 'later', 'noDate'];

export function taskGroup(dueDate: string | null, today: string): TaskGroup {
  if (dueDate === null) return 'noDate';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  return dueDate <= addDays(today, 6) ? 'week' : 'later';
}

/** The phone sheet's day groups of mentions (past) and reminders (coming). */
export function dayGroup(
  iso: string,
  today: string,
): 'earlier' | 'yesterday' | 'today' | 'tomorrow' | 'later' {
  const day = todayInBratislava(new Date(iso));
  if (day === today) return 'today';
  if (day < today) return day === addDays(today, -1) ? 'yesterday' : 'earlier';
  return day === addDays(today, 1) ? 'tomorrow' : 'later';
}

/** A second, muted line of details, joined by a middle dot. */
function MetaLine({ parts }: { parts: ReactNode[] }) {
  const shown = parts.filter(Boolean);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-micro text-muted-foreground">
      {shown.map((part, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <span aria-hidden="true">·</span>}
          {part}
        </span>
      ))}
    </span>
  );
}

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
  if (item.target.kind === 'task') return taskTarget(item.groupId, item.target.taskId);
  // Phase 32: a contract's reminder opens the item in the client's Finance tab.
  if (item.target.kind === 'finance') {
    return {
      to: '/groups/$groupId/finance',
      params: { groupId: item.groupId },
      search: { item: item.target.itemId },
    };
  }
  return {
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
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-button',
          task.unseen ? 'font-bold' : 'font-semibold',
        )}
      >
        {task.title}
      </span>
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

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="shrink-0"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/**
 * A "Fill in your time" row (Phase 32): the clock on the attention yellow, the task's or ticket's
 * title, its client and the day of its completion (resolution).
 */
function TimeRow({ request, detail = false }: { request: TimeRequest; detail?: boolean }) {
  const { t, i18n } = useTranslation();
  const day = formatDue(request.workedOn, i18n.language);
  const icon = (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-attention text-attention-foreground">
      <ClockIcon />
    </span>
  );
  if (detail) {
    return (
      <>
        {icon}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-button font-semibold">{request.title}</span>
          <MetaLine
            parts={[
              <span key="what">{t('adminHome.cards.assigned.fillTime')}</span>,
              <span key="client" className="truncate">
                {request.groupName ?? t('adminHome.cards.tickets.noClient')}
              </span>,
              <span key="day" className="tabular-nums">
                {day}
              </span>,
            ]}
          />
        </span>
      </>
    );
  }
  return (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate text-button font-semibold">{request.title}</span>
      <span className="hidden max-w-[40%] truncate text-micro text-muted-foreground min-[641px]:inline">
        {request.groupName ?? t('adminHome.cards.tickets.noClient')}
      </span>
      <span className="shrink-0 text-micro text-muted-foreground tabular-nums">{day}</span>
    </>
  );
}

/** Opens the time dialog in place for a request (no navigation). */
function askAbout(request: TimeRequest) {
  if (request.kind === 'task' && request.taskId && request.groupId) {
    askForTime({
      kind: 'task',
      id: request.taskId,
      groupId: request.groupId,
      title: request.title,
    });
  } else if (request.ticketId) {
    askForTime({
      kind: 'ticket',
      id: request.ticketId,
      groupId: request.groupId,
      title: request.title,
    });
  }
}

function AssignedDetail({ task, today }: { task: AssignedTask; today: string }) {
  const { t, i18n } = useTranslation();
  const overdue = isOverdue(task.dueDate, task.bucketKind, today);
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-2">
        {task.urgent && <Badge variant="destructive">{t('adminHome.cards.urgent')}</Badge>}
        <span
          className={cn('line-clamp-2 text-button', task.unseen ? 'font-bold' : 'font-semibold')}
        >
          {task.title}
        </span>
      </span>
      <MetaLine
        parts={[
          <span key="client" className="truncate">
            {task.groupName}
          </span>,
          <span key="due" className={cn('tabular-nums', overdue && 'font-semibold text-error-ink')}>
            {task.dueDate === null
              ? t('adminHome.cards.assigned.noDate')
              : formatDue(task.dueDate, i18n.language)}
          </span>,
        ]}
      />
    </span>
  );
}

export function useAssignedCard(): CountCardProps {
  const { t } = useTranslation();
  const query = useQuery(assignedQuery);
  const today = todayInBratislava();
  const data = query.data;
  // Phase 32: the viewer's open time requests come first, whatever the notification settings.
  const timeRows = (data?.timeRequests ?? []).map((request) => ({
    key: `time:${request.entryId}`,
    to:
      request.kind === 'task' && request.taskId && request.groupId
        ? taskTarget(request.groupId, request.taskId)
        : { to: '/tickets/$ticketId', params: { ticketId: request.ticketId ?? '' } },
    onSelect: () => askAbout(request),
    label: t('adminHome.cards.assigned.fillTimeFor', { title: request.title }),
    content: <TimeRow request={request} />,
    group: t('adminHome.cards.assigned.fillTime'),
    detail: <TimeRow request={request} detail />,
    rank: -1,
  }));
  const taskRows = (data?.items ?? []).map((task) => ({
    key: task.id,
    to: taskTarget(task.groupId, task.id),
    content: <AssignedRow task={task} today={today} />,
    group: t(`adminHome.sheet.groups.${taskGroup(task.dueDate, today)}`),
    detail: <AssignedDetail task={task} today={today} />,
    marker: task.unseen && (
      <UnseenMarker mark={task.unseen} target={{ kind: 'task', id: task.id }} />
    ),
    rank: TASK_GROUPS.indexOf(taskGroup(task.dueDate, today)),
  }));
  const rows = [...timeRows, ...taskRows];
  const withoutTime = data?.timeRequestCount ?? 0;
  return {
    id: 'tasks',
    title: t('adminHome.cards.assigned.title'),
    description: t('adminHome.sheet.tasks.description'),
    openAll: {
      label: t('adminHome.sheet.tasks.openAll'),
      to: { to: '/tasks', search: { assignee: 'me', clients: 'all' } },
    },
    count: data?.total ?? 0,
    caption: t('adminHome.cards.assigned.caption'),
    subline: (
      <>
        <span className="flex items-center gap-1.5 text-micro text-muted-foreground">
          {(data?.urgent ?? 0) > 0 && (
            <span aria-hidden="true" className="size-2 rounded-full bg-destructive" />
          )}
          {t('adminHome.cards.assigned.urgent', { count: data?.urgent ?? 0 })}
        </span>
        {withoutTime > 0 && (
          <span className="flex items-center gap-1.5 text-micro text-muted-foreground">
            <span aria-hidden="true" className="size-2 rounded-full bg-attention" />
            {t('adminHome.cards.assigned.withoutTime', { n: withoutTime })}
          </span>
        )}
      </>
    ),
    rows,
    // The server sends urgent first, then soonest; the sheet groups by due date (stable sort, so
    // urgent stays first in each group).
    sheetRows: [...rows].sort((a, b) => a.rank - b.rank),
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

function TicketRow({ ticket, today }: { ticket: HomeTicket; today: string }) {
  const { t, i18n } = useTranslation();
  const overdue = ticket.dueDate !== null && ticket.dueDate < today;
  return (
    <>
      <span className="shrink-0 text-micro text-muted-foreground tabular-nums">
        #{ticket.number}
      </span>
      {ticket.status === 'new' && <Badge>{t('adminHome.cards.tickets.new')}</Badge>}
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-button',
          ticket.unseen ? 'font-bold' : 'font-semibold',
        )}
      >
        {ticket.subject ?? ticket.excerpt ?? ''}
      </span>
      <span className="hidden max-w-[40%] truncate text-micro text-muted-foreground min-[641px]:inline">
        {ticket.groupName ?? t('adminHome.cards.tickets.noClient')}
      </span>
      {ticket.dueDate !== null && (
        <span
          className={cn(
            'shrink-0 text-micro tabular-nums',
            overdue ? 'font-semibold text-error-ink' : 'text-foreground',
          )}
        >
          {formatDue(ticket.dueDate, i18n.language)}
        </span>
      )}
    </>
  );
}

function TicketDetail({ ticket, today }: { ticket: HomeTicket; today: string }) {
  const { t, i18n } = useTranslation();
  const overdue = ticket.dueDate !== null && ticket.dueDate < today;
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 text-micro text-muted-foreground tabular-nums">
          #{ticket.number}
        </span>
        <span
          className={cn('line-clamp-2 text-button', ticket.unseen ? 'font-bold' : 'font-semibold')}
        >
          {ticket.subject ?? ticket.excerpt ?? ''}
        </span>
      </span>
      <MetaLine
        parts={[
          <span key="client" className="truncate">
            {ticket.groupName ?? t('adminHome.cards.tickets.noClient')}
          </span>,
          ticket.dueDate !== null && (
            <span
              key="due"
              className={cn('tabular-nums', overdue && 'font-semibold text-error-ink')}
            >
              {formatDue(ticket.dueDate, i18n.language)}
            </span>
          ),
          !ticket.hasAssignee && (
            <span key="assignee" className="font-semibold text-foreground">
              {t('adminHome.sheet.tickets.noAssignee')}
            </span>
          ),
        ]}
      />
    </span>
  );
}

/**
 * The Tickets card: the active tickets (New, In progress) I am a riešiteľ of, those without a
 * riešiteľ of the clients whose tickets I watch, and those without a client; New first, each
 * marked "New". "Show all" opens the global ticket list.
 */
export function useTicketsCard(): CountCardProps {
  const { t } = useTranslation();
  const query = useQuery(ticketsQuery);
  const today = todayInBratislava();
  const data = query.data;
  return {
    id: 'tickets',
    title: t('adminHome.cards.tickets.title'),
    description: t('adminHome.sheet.tickets.description'),
    openAll: { label: t('adminHome.sheet.tickets.openAll'), to: { to: '/tickets' } },
    count: data?.total ?? 0,
    caption: t('adminHome.cards.tickets.caption'),
    subline: (
      <span className="flex flex-col gap-0.5 text-micro text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {(data?.fresh ?? 0) > 0 && (
            <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
          )}
          {t('adminHome.cards.tickets.fresh', { count: data?.fresh ?? 0 })}
        </span>
        <span>{t('adminHome.cards.tickets.noAssignee', { count: data?.noAssignee ?? 0 })}</span>
      </span>
    ),
    rows: (data?.items ?? []).map((ticket) => ({
      key: ticket.id,
      to: { to: '/tickets/$ticketId', params: { ticketId: ticket.id } },
      content: <TicketRow ticket={ticket} today={today} />,
      group: t(
        ticket.status === 'new'
          ? 'adminHome.sheet.groups.new'
          : 'adminHome.sheet.groups.inProgress',
      ),
      detail: <TicketDetail ticket={ticket} today={today} />,
      marker: ticket.unseen && (
        <UnseenMarker mark={ticket.unseen} target={{ kind: 'ticket', id: ticket.id }} />
      ),
    })),
    empty: t('adminHome.cards.tickets.empty'),
    showAll:
      data && data.total > data.items.length
        ? {
            label: t('adminHome.cards.tickets.showAll', { count: data.total }),
            to: { to: '/tickets' },
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
  const today = todayInBratislava();
  return {
    id: 'reminders',
    title: t('adminHome.cards.reminders.title'),
    description: t('adminHome.sheet.reminders.description'),
    count: data?.nextWeek ?? 0,
    caption: t('adminHome.cards.reminders.caption'),
    rows: (data?.items ?? []).map((item) => ({
      key: item.id,
      to: reminderTarget(item),
      tall: true,
      group: t(`adminHome.sheet.groups.${dayGroup(item.at, today)}`),
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
  const today = todayInBratislava();
  return {
    id: 'mentions',
    title: t('adminHome.cards.mentions.title'),
    description: t('adminHome.sheet.mentions.description'),
    count: data?.total ?? 0,
    caption: t('adminHome.cards.mentions.caption'),
    rows: (data?.items ?? []).map((item) => ({
      key: item.messageId,
      to: mentionTarget(item),
      tall: true,
      group: t(`adminHome.sheet.groups.${dayGroup(item.createdAt, today)}`),
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

const meetingTarget = (meeting: HomeMeeting): CardTarget => ({
  to: '/groups/$groupId/knowledge',
  params: { groupId: meeting.groupId },
  search: { k: meeting.id },
});

/**
 * The Meetings card (Phase 30): meetings of my clients in the next 7 days, soonest first, then
 * past meetings of the last 30 days still without a summary, marked "No summary". The count is
 * the coming week's.
 */
export function useMeetingsCard(): CountCardProps {
  const { t, i18n } = useTranslation();
  const query = useQuery(meetingsQuery);
  const data = query.data;
  const today = todayInBratislava();
  const when = new Intl.DateTimeFormat(locale(i18n.language), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Bratislava',
  });
  const row = (meeting: HomeMeeting, past: boolean) => ({
    key: meeting.id,
    to: meetingTarget(meeting),
    tall: true,
    content: (
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-micro text-muted-foreground tabular-nums">
            {when.format(new Date(meeting.startsAt))}, {meeting.groupName}
          </span>
          <span className="truncate text-button font-semibold">{meeting.title}</span>
        </span>
        {past && <Badge variant="outline">{t('adminHome.cards.meetings.noSummary')}</Badge>}
      </span>
    ),
    // The phone sheet: upcoming by day, then the past ones still without a summary.
    group: t(
      past
        ? 'adminHome.sheet.groups.noSummary'
        : `adminHome.sheet.groups.${dayGroup(meeting.startsAt, today)}`,
    ),
    detail: (
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-button font-semibold">{meeting.title}</span>
        <MetaLine
          parts={[
            <span key="when" className="tabular-nums">
              {when.format(new Date(meeting.startsAt))}
            </span>,
            <span key="client" className="truncate">
              {meeting.groupName}
            </span>,
            past && (
              <span key="summary" className="font-semibold text-foreground">
                {t('adminHome.cards.meetings.noSummary')}
              </span>
            ),
          ]}
        />
      </span>
    ),
  });
  return {
    id: 'meetings',
    title: t('adminHome.cards.meetings.title'),
    description: t('adminHome.sheet.meetings.description'),
    openAll: {
      label: t('adminHome.sheet.meetings.openAll'),
      to: { to: '/knowledge', search: { type: 'meeting' } },
    },
    count: data?.upcomingTotal ?? 0,
    caption: t('adminHome.cards.meetings.caption'),
    subline: (
      <span className="text-micro text-muted-foreground">
        {t('adminHome.cards.meetings.unsummarized', { count: data?.unsummarizedTotal ?? 0 })}
      </span>
    ),
    rows: [
      ...(data?.upcoming ?? []).map((m) => row(m, false)),
      ...(data?.unsummarized ?? []).map((m) => row(m, true)),
    ],
    empty: t('adminHome.cards.meetings.empty'),
    state: stateOf(query),
    onRetry: () => void query.refetch(),
  };
}
