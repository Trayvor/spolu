import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  RemindersEvents,
  type ReminderPut,
  type ReminderSetDto,
  type TaskDetailDto,
  type TaskRemindersEvent,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { AddReminderRow } from '@/features/reminders/add-reminder-row';
import { putReminderSet, reminderSetQuery } from '@/features/reminders/api';
import { RecipientsField } from '@/features/reminders/recipients-field';
import { CalendarLink, ReminderPanel } from '@/features/reminders/reminder-panel';
import { isoToLocal, localDate } from '@/features/reminders/reminder-times-field';

/** How long "Saved" shows after a change. */
const SAVED_MS = 2000;

/** Which automatic reminders a task has (Phase 6): the muted line above the custom times. */
export function automaticReminderLine(task: {
  dueDate: string | null;
  urgent: boolean;
}): 'deadline' | 'deadlineUrgent' | 'urgent' | null {
  if (task.dueDate) return task.urgent ? 'deadlineUrgent' : 'deadline';
  return task.urgent ? 'urgent' : null;
}

const LINE_KEYS = {
  deadline: 'reminders.task.autoDeadline',
  deadlineUrgent: 'reminders.task.autoDeadlineUrgent',
  urgent: 'reminders.task.autoUrgent',
} as const;

/** The time falls on a later local calendar day than the deadline (not a UTC comparison). */
export function isAfterDeadline(iso: string, dueDate: string | null): boolean {
  return dueDate !== null && isoToLocal(iso).date > dueDate;
}

/** The add row's first date: the deadline when it is after today (local), else today. */
export function defaultReminderDate(dueDate: string | null, now = new Date()): string {
  const today = localDate(now);
  return dueDate && dueDate > today ? dueDate : today;
}

type Change =
  | { kind: 'add'; at: string }
  | { kind: 'remove'; id: string }
  | { kind: 'recipients'; ids: string[] };

/**
 * The reminders section of a task's Details tab. It is not part of the task form: each change
 * (add a time, remove one, change the recipients) saves at once with one `PUT`, which sends the
 * upcoming times it had loaded as `baseTimeIds`, so a time someone else added meanwhile survives,
 * and leaves `recipientIds` out unless the recipients changed. The automatic-reminder line reads
 * the saved `task`. A 404 on save means the task is gone (`onTaskGone`).
 */
export function TaskReminders({
  task,
  onTaskGone,
}: {
  task: TaskDetailDto;
  onTaskGone: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useQuery(reminderSetQuery('task', task.id));
  const set = query.data;
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | undefined>();
  const [editing, setEditing] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(savedTimer.current), []);

  // Someone changed this task's reminders, or the fire job sent one: refetch.
  useEffect(() => {
    const socket = getSocket();
    const onReminders = (event: TaskRemindersEvent) => {
      if (event.taskId !== task.id) return;
      void queryClient.invalidateQueries({ queryKey: reminderSetQuery('task', task.id).queryKey });
    };
    socket.on(RemindersEvents.task, onReminders);
    return () => void socket.off(RemindersEvents.task, onReminders);
  }, [queryClient, task.id]);

  const line = automaticReminderLine(task);
  const intro = line && <p className="text-micro text-muted-foreground">{t(LINE_KEYS[line])}</p>;
  const heading = (
    <h3 id={`task-reminders-${task.id}`} className="text-button font-semibold">
      {t('reminders.task.title')}
    </h3>
  );

  if (!set) {
    // Loading, or the set could not be read (the panel handles a deleted task itself).
    return (
      <section aria-labelledby={`task-reminders-${task.id}`} className="flex flex-col gap-4">
        {heading}
        {intro}
      </section>
    );
  }

  const upcoming = set.times
    .filter((time) => time.firedAt === null)
    .sort((a, b) => a.at.localeCompare(b.at));
  const authorId = set.recipients.find((r) => r.source === 'author')?.user.id ?? '';
  const added = set.recipients.filter((r) => r.source === 'added').map((r) => r.user.id);

  async function save(change: Change) {
    if (busy) return;
    const loaded = upcoming.map(({ id, at }) => ({ id, at }));
    const body: ReminderPut = {
      times:
        change.kind === 'add'
          ? [...loaded, { at: change.at }]
          : change.kind === 'remove'
            ? loaded.filter((time) => time.id !== change.id)
            : loaded,
      baseTimeIds: loaded.map((time) => time.id),
      ...(change.kind === 'recipients' ? { recipientIds: change.ids } : {}),
    };
    setBusy(true);
    setFailed(false);
    setAddError(undefined);
    try {
      const next = await putReminderSet('task', task.id, body);
      queryClient.setQueryData<ReminderSetDto>(reminderSetQuery('task', task.id).queryKey, next);
      if (change.kind === 'add') setAdding(false);
      if (change.kind === 'recipients') setEditing(null);
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), SAVED_MS);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) onTaskGone();
      else if (
        change.kind === 'add' &&
        error instanceof ApiError &&
        error.code === 'reminder_in_past'
      )
        setAddError(t('reminders.task.inPast'));
      else setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const addControl = adding ? (
    <AddReminderRow
      defaultDate={defaultReminderDate(task.dueDate)}
      onAdd={(at) => void save({ kind: 'add', at })}
      onCancel={() => {
        setAdding(false);
        setAddError(undefined);
      }}
      error={addError}
      busy={busy}
    />
  ) : (
    upcoming.length < 20 && (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setAdding(true)}
        className="self-start max-[640px]:h-11"
      >
        <span aria-hidden="true">+</span>
        {t('reminders.row.add')}
      </Button>
    )
  );

  const status = (
    <>
      <p aria-live="polite" className="text-micro text-muted-foreground empty:hidden">
        {saved ? t('reminders.task.saved') : ''}
      </p>
      {failed && (
        <p role="alert" className="text-button text-error-ink">
          {t('reminders.task.saveFailed')}
        </p>
      )}
    </>
  );

  if (upcoming.length === 0) {
    return (
      <section aria-labelledby={`task-reminders-${task.id}`} className="flex flex-col gap-4">
        {heading}
        {intro}
        {addControl}
        <div className="flex justify-end">
          {task.dueDate ? (
            <CalendarLink prefix="/tasks" subjectId={task.id} />
          ) : (
            // Nothing to export: no deadline and no upcoming reminder.
            <Button type="button" variant="outline" size="sm" disabled>
              {t('reminders.panel.addToCalendar')}
            </Button>
          )}
        </div>
        {status}
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ReminderPanel
        prefix="/tasks"
        subjectId={task.id}
        set={set}
        authorId={authorId}
        onChanged={() => void query.refetch()}
        hideFired
        intro={intro}
        timeTag={(iso) =>
          isAfterDeadline(iso, task.dueDate) ? t('reminders.task.afterDeadline') : null
        }
        onRemoveTime={(id) => void save({ kind: 'remove', id })}
        remindedLabel={t('reminders.task.reminded')}
        authorMark={t('reminders.task.setThem')}
        calendarAvailable
        recipientsAction={
          editing === null && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditing(added)}
              className="max-[640px]:h-11"
            >
              {t('reminders.task.change')}
            </Button>
          )
        }
      >
        {addControl}
        {editing !== null && (
          <div className="flex flex-col gap-2.5">
            <RecipientsField
              groupId={task.groupId}
              value={editing}
              onChange={(ids) => setEditing(ids.filter((id) => id !== authorId))}
              authorId={authorId}
              adminsOnly={false}
              suggestion={{
                label: t('reminders.task.addAssignees'),
                ids: task.assignees.map((p) => p.id),
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void save({ kind: 'recipients', ids: editing })}
              className="self-start max-[640px]:h-11"
            >
              {t('reminders.task.done')}
            </Button>
          </div>
        )}
      </ReminderPanel>
      {status}
    </div>
  );
}
