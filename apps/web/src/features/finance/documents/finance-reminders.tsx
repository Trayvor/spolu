import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  REMINDER_PUT_LIMITS,
  type GroupPerson,
  type ReminderPut,
  type ReminderSetDto,
} from '@spolu/shared';
import { PeopleSelect } from '@/components/people-select';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { AddReminderRow } from '@/features/reminders/add-reminder-row';
import { putReminderSet, reminderSetQuery } from '@/features/reminders/api';
import { ReminderPanel } from '@/features/reminders/reminder-panel';
import { localDate } from '@/features/reminders/reminder-times-field';
import { financePeopleQuery } from './api';

type Change =
  | { kind: 'add'; at: string }
  | { kind: 'remove'; id: string }
  | { kind: 'recipients'; ids: string[] };

const PREFIX = '/finance-items';
const anyone = () => true;

/**
 * A saved finance item's reminders (spec §2.3, decision 14), edited on their own like a task's:
 * each change (add a time, remove one, change who gets them) saves at once with one `PUT`
 * through the reminders module. Recipients are picked from the finance admins only (the server
 * refuses anyone else). The add row starts at the proposal (a contract: 30 days before the end;
 * an expense, Phase 32 E: the day before its date).
 */
export function FinanceReminders({
  itemId,
  proposal,
  onGone,
}: {
  itemId: string;
  /** The add row's first day: the contract's or the expense's proposal (null: today). */
  proposal: { date: string } | null;
  onGone: () => void;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const client = useQueryClient();
  const query = useQuery(reminderSetQuery('finance', itemId));
  const financePeople = useQuery(financePeopleQuery).data;
  const people = useMemo<GroupPerson[] | undefined>(
    () => financePeople?.map((p) => ({ ...p, isAdmin: true, isManager: true })),
    [financePeople],
  );
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = query.data;
  const k = (key: string) => t(`financeDocuments.reminders.${key}`);

  const heading = (
    <h3 id={`${uid}-title`} className="text-button font-semibold">
      {k('title')}
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
    setError(null);
    setSaved(false);
    try {
      const next = await putReminderSet('finance', itemId, body);
      client.setQueryData<ReminderSetDto>(reminderSetQuery('finance', itemId).queryKey, next);
      if (change.kind === 'add') setAdding(false);
      if (change.kind === 'recipients') setEditing(null);
      setSaved(true);
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : undefined;
      if (caught instanceof ApiError && caught.status === 404) onGone();
      else if (code === 'reminder_in_past') setError(k('inPast'));
      else if (code === 'invalid_recipient') setError(k('invalidRecipient'));
      else setError(k('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  const addControl = adding ? (
    <AddReminderRow
      defaultDate={proposal?.date ?? localDate(new Date())}
      onAdd={(at) => void save({ kind: 'add', at })}
      onCancel={() => setAdding(false)}
      busy={busy}
    />
  ) : (
    upcoming.length < REMINDER_PUT_LIMITS.times && (
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
        {saved ? k('saved') : ''}
      </p>
      {error && (
        <p role="alert" className="text-button text-error-ink">
          {error}
        </p>
      )}
    </>
  );

  if (upcoming.length === 0 && set.recipients.length === 0) {
    return (
      <section aria-labelledby={`${uid}-title`} className="flex flex-col gap-3">
        {heading}
        <p className="text-tiny text-muted-foreground">{k('empty')}</p>
        {addControl}
        {status}
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ReminderPanel
        prefix={PREFIX}
        subjectId={itemId}
        set={set}
        authorId={authorId}
        onChanged={() => void query.refetch()}
        hideFired
        onRemoveTime={(id) => void save({ kind: 'remove', id })}
        unavailableText={k('unavailable')}
        recipientsAction={
          editing === null && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditing(added)}
              className="max-[640px]:h-11"
            >
              {k('change')}
            </Button>
          )
        }
      >
        {addControl}
        {editing !== null && (
          <div className="flex flex-col gap-2.5">
            <label htmlFor={`${uid}-people`} className="text-button font-semibold">
              {k('recipients')}
            </label>
            <PeopleSelect
              people={people}
              value={[authorId, ...editing.filter((id) => id !== authorId)]}
              onChange={(ids) => setEditing(ids.filter((id) => id !== authorId))}
              fixedIds={[authorId]}
              inputId={`${uid}-people`}
              max={REMINDER_PUT_LIMITS.recipients}
              label={k('recipients')}
              pickable={anyone}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => void save({ kind: 'recipients', ids: editing })}
                className="max-[640px]:h-11"
              >
                {k('done')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditing(null)}
                className="max-[640px]:h-11"
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
