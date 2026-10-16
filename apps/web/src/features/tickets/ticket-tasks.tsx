import { lazy, Suspense, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { MessageTaskLink, TicketDto } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';
import { aiStatusQuery } from '@/features/task-split/api';
import { TasksIcon } from '@/features/task-split/use-message-task-tools';
import { withNamespaces } from '@/i18n/namespaces';
import { cn } from '@/lib/utils';
import { ticketQuery } from './api';

// The review dialog and its task form load only when "Turn into tasks" is pressed.
const ReviewDialog = lazy(
  withNamespaces(
    ['forms', 'tasks', 'taskSplit'],
    () => import('@/features/task-split/review-dialog'),
  ),
);

/**
 * The ticket's tasks for the people who use its group's board (admins and the group's clients,
 * part 21.5): a link per task to the board's task panel, a completed one struck through, and
 * "Turn into tasks" (while the server has the AI on), which opens the Phase 9 review dialog with
 * the ticket as its source. After the cards are created the ticket refetches and a toast offers
 * the board. Nothing shows while there are no tasks and the AI is off.
 */
export function TicketTasks({
  ticket,
  groupId,
  tasks,
}: {
  ticket: TicketDto;
  groupId: string;
  tasks: MessageTaskLink[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const aiOn = useQuery(aiStatusQuery).data?.taskSplit === true;
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<number | null>(null);
  if (!aiOn && tasks.length === 0) return null;

  return (
    <section
      aria-labelledby="ticket-tasks"
      className="flex flex-col gap-3 border-t-2 border-border pt-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="ticket-tasks" className="text-button font-semibold">
          {t('tickets.tasks.title')}
          {tasks.length > 0 && (
            <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
              {tasks.length}
            </span>
          )}
        </h2>
        {aiOn && (
          <Button
            size="sm"
            variant="secondary"
            className="pl-3"
            onClick={() => {
              setCreated(null);
              setOpen(true);
            }}
          >
            <TasksIcon />
            {t('chat.actions.turnIntoTasks')}
          </Button>
        )}
      </div>
      {tasks.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {tasks.map((task) => (
            <li key={task.id} className="min-w-0">
              <Link
                to="/groups/$groupId/tasks/$taskId"
                params={{ groupId, taskId: task.id }}
                className={cn(
                  'block truncate text-tiny font-semibold underline underline-offset-4 hover:text-neutral',
                  task.completed && 'text-muted-foreground line-through',
                )}
              >
                {task.title}
                {task.completed && <span className="sr-only"> {t('tickets.tasks.completed')}</span>}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-micro text-muted-foreground">{t('tickets.tasks.none')}</p>
      )}
      {open && (
        <Suspense fallback={null}>
          <ReviewDialog
            groupId={groupId}
            source={{ kind: 'ticket', ticket }}
            onClose={() => setOpen(false)}
            onCreated={(list) => {
              setOpen(false);
              setCreated(list.length);
              void queryClient.invalidateQueries({ queryKey: ticketQuery(ticket.id).queryKey });
            }}
          />
        </Suspense>
      )}
      {created !== null && (
        <Toast onClose={() => setCreated(null)}>
          <span>{t('taskSplit.created', { count: created })}</span>
          <Link
            to="/groups/$groupId/tasks"
            params={{ groupId }}
            onClick={() => setCreated(null)}
            className="font-semibold underline underline-offset-4 hover:text-neutral"
          >
            {t('taskSplit.openBoard')}
          </Link>
        </Toast>
      )}
    </section>
  );
}
