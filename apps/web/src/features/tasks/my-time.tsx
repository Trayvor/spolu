import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { formatDuration, type SessionUser, type TaskTimeAssignee } from '@spolu/shared';
import { isAdmin } from '@/features/auth/roles';
import { Button } from '@/components/ui/button';
import { taskTimeQuery, ticketTimeQuery } from './time-api';
import { askForTime, ticketAskTitle, type TimeAsk } from './time-queue';

/** Who sees "My time" (Phase 32): an admin who is an assignee now, or any finance admin. */
export function seesTime(me: SessionUser | null, assigneeIds: readonly string[]): boolean {
  return isAdmin(me) && (assigneeIds.includes(me!.id) || me!.finance);
}

const minutesText = (t: TFunction, minutes: number) =>
  formatDuration(minutes, {
    hours: t('tasks.time.units.hours'),
    minutes: t('tasks.time.units.minutes'),
  });

type Mine = { minutes: number | null; requested: boolean; coveredByTasks?: boolean };

/**
 * "My time" under a task's assignees (and on a ticket page, spec §5.3 and §5.6): "Not filled"
 * with an amber dot and "Fill in", or the minutes with "Edit", both opening the time dialog. A
 * finance admin also sees every admin's time in one line. Nothing for anyone else.
 */
function TimeBlock({
  mine,
  assignees,
  ask,
  state,
  onRetry,
}: {
  mine: Mine | null | undefined;
  assignees: (TaskTimeAssignee & { coveredByTasks?: boolean })[] | undefined;
  ask: TimeAsk;
  state: 'loading' | 'error' | 'ready';
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (state === 'loading') return null;
  if (state === 'error') {
    return (
      <p className="flex items-center gap-2 text-button text-muted-foreground" role="alert">
        {t('tasks.time.loadFailed')}
        <Button type="button" size="sm" variant="ghost" onClick={onRetry}>
          {t('tasks.time.retry')}
        </Button>
      </p>
    );
  }
  const filled = mine !== null && mine !== undefined && mine.minutes !== null;
  const valueOf = (entry: Mine) =>
    entry.coveredByTasks
      ? t('tasks.time.covered')
      : entry.minutes === null
        ? t('tasks.time.notFilled')
        : minutesText(t, entry.minutes);
  return (
    <div className="flex flex-col gap-2" data-testid="my-time">
      {mine && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="text-micro font-semibold">{t('tasks.time.mine')}</span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-button tabular-nums">
              {!filled && (
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-attention" />
              )}
              {valueOf(mine)}
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => askForTime(ask)}>
              {filled ? t('tasks.time.edit') : t('tasks.time.fill')}
            </Button>
          </span>
        </div>
      )}
      {assignees && assignees.length > 0 && (
        <p className="text-micro text-muted-foreground">
          {t('tasks.time.everyone', {
            list: assignees.map((a) => `${a.name} ${valueOf(a)}`).join(', '),
          })}
        </p>
      )}
    </div>
  );
}

const stateOf = (q: { isPending: boolean; isError: boolean }) =>
  q.isPending ? 'loading' : q.isError ? 'error' : 'ready';

export function TaskMyTime({ task }: { task: { id: string; groupId: string; title: string } }) {
  const query = useQuery(taskTimeQuery(task.id));
  return (
    <TimeBlock
      mine={query.data?.mine}
      assignees={query.data?.assignees}
      ask={{ kind: 'task', id: task.id, groupId: task.groupId, title: task.title }}
      state={stateOf(query)}
      onRetry={() => void query.refetch()}
    />
  );
}

export function TicketMyTime({
  ticket,
}: {
  ticket: { id: string; groupId: string | null; subject: string | null; number: number };
}) {
  const query = useQuery(ticketTimeQuery(ticket.id));
  return (
    <TimeBlock
      mine={query.data?.mine}
      assignees={query.data?.assignees}
      ask={{
        kind: 'ticket',
        id: ticket.id,
        groupId: ticket.groupId,
        title: ticketAskTitle(ticket.number, ticket.subject),
      }}
      state={stateOf(query)}
      onRetry={() => void query.refetch()}
    />
  );
}
