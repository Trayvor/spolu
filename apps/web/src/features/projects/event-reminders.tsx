import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { REMINDER_PUT_LIMITS, type ReminderPut, type ReminderSetDto } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { useNamespaces } from '@/i18n/namespaces';
import { ApiError } from '@/lib/api';
import { AddReminderRow } from '@/features/reminders/add-reminder-row';
import { putReminderSet, reminderSetQuery } from '@/features/reminders/api';
import { RecipientsField } from '@/features/reminders/recipients-field';
import { ReminderPanel } from '@/features/reminders/reminder-panel';
import { localDate } from '@/features/reminders/reminder-times-field';

/** How long "Saved" shows after a change. */
const SAVED_MS = 2000;
const PREFIX = '/project-events';

type Change =
  | { kind: 'add'; at: string }
  | { kind: 'remove'; id: string }
  | { kind: 'recipients'; ids: string[] };

/** The add row's first date: the day before the event while that is still ahead, else today. */
export function eventReminderDate(occursOn: string, now = new Date()): string {
  const today = localDate(now);
  const [y, m, d] = occursOn.split('-').map(Number);
  const before = localDate(new Date(y!, m! - 1, d! - 1));
  return before > today ? before : today;
}

/**
 * The reminders of a project event (F15), in the event sheet: everyone who reads the group sets
 * them and picks who gets them from the group's people, as on a task. Each change (add a time,
 * remove one, change the recipients) saves at once with one `PUT`, which sends the times it had
 * loaded as `baseTimeIds`. A 404 on save means the event is gone (`onGone`). Loads the
 * `reminders` texts itself: render it under a `<Suspense>`.
 */
export function EventReminders({
  eventId,
  groupId,
  occursOn,
  onGone,
}: {
  eventId: string;
  groupId: string;
  occursOn: string;
  onGone: () => void;
}) {
  useNamespaces(['reminders']);
  const { t } = useTranslation();
  const uid = useId();
  const client = useQueryClient();
  const query = useQuery(reminderSetQuery('event', eventId));
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | undefined>();
  const [editing, setEditing] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(savedTimer.current), []);
  const set = query.data;

  const heading = (
    <h3 id={`${uid}-title`} className="text-button font-semibold">
      {t('reminders.panel.title')}
    </h3>
  );
  if (!set) return heading;

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
      const next = await putReminderSet('event', eventId, body);
      client.setQueryData<ReminderSetDto>(reminderSetQuery('event', eventId).queryKey, next);
      if (change.kind === 'add') setAdding(false);
      if (change.kind === 'recipients') setEditing(null);
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), SAVED_MS);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) onGone();
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
      defaultDate={eventReminderDate(occursOn)}
      onAdd={(at) => {
        if (upcoming.some((time) => Date.parse(time.at) === Date.parse(at))) {
          setAddError(t('reminders.fields.errors.duplicate'));
          return;
        }
        void save({ kind: 'add', at });
      }}
      onCancel={() => {
        setAdding(false);
        setAddError(undefined);
      }}
      error={addError}
      busy={busy}
    />
  ) : (
    upcoming.length < REMINDER_PUT_LIMITS.times && (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setAdding(true)}
        className="self-start touch:h-11"
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
      <section aria-labelledby={`${uid}-title`} className="flex flex-col gap-3">
        {heading}
        <p className="text-tiny text-muted-foreground">{t('reminders.event.empty')}</p>
        {addControl}
        {status}
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ReminderPanel
        prefix={PREFIX}
        subjectId={eventId}
        set={set}
        authorId={authorId}
        onChanged={() => void query.refetch()}
        hideFired
        onRemoveTime={(id) => void save({ kind: 'remove', id })}
        remindedLabel={t('reminders.task.reminded')}
        authorMark={t('reminders.task.setThem')}
        authorHint={t('reminders.task.authorHint')}
        unavailableText={t('reminders.event.unavailable')}
        recipientsAction={
          editing === null && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditing(added)}
              className="touch:h-11"
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
              groupId={groupId}
              value={editing}
              onChange={(ids) => setEditing(ids.filter((id) => id !== authorId))}
              authorId={authorId}
              adminsOnly={false}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => void save({ kind: 'recipients', ids: editing })}
                className="touch:h-11"
              >
                {t('reminders.task.done')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditing(null)}
                className="touch:h-11"
              >
                {t('reminders.row.cancel')}
              </Button>
            </div>
          </div>
        )}
      </ReminderPanel>
      {status}
    </div>
  );
}
