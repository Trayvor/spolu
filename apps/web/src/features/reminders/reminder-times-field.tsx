import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { KNOWLEDGE_LIMITS } from '@spolu/shared';
import { CloseIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * One reminder time in the form: local `date` (YYYY-MM-DD) and `time` (HH:mm). `key` is a
 * client-side row key for a time without an `id` (never sent).
 */
export type ReminderTimeValue = {
  id?: string;
  key?: string;
  date: string;
  time: string;
  firedAt: string | null;
};

let rowSeq = 0;
/** A fresh client-side key for a new time row. */
export function newRowKey(): string {
  rowSeq += 1;
  return `new-${rowSeq}`;
}

const rowKey = (row: ReminderTimeValue, index: number) => row.id ?? row.key ?? `index-${index}`;

type FocusTarget = { kind: 'date' | 'remove'; key: string } | { kind: 'add' };

const pad = (n: number) => String(n).padStart(2, '0');

/** The local date of `d` as YYYY-MM-DD. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A local date and time (the browser's time zone) as an ISO instant; '' when either is invalid. */
export function localToIso(date: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return '';
  // A date-time without an offset is read as local time.
  const d = new Date(`${date}T${time}:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** An ISO instant as the browser's local date and time. */
export function isoToLocal(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return { date: localDate(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/**
 * The times of a reminder: a row of native date and time inputs each. Unfired rows can be
 * removed; fired rows are read-only, muted and marked "sent". "+ Add time" adds a row (the
 * last unfired one's date, or tomorrow, at 09:00) until there are 20. `errors` marks rows by
 * index. Needs the `reminders` locale namespace.
 */
export function ReminderTimesField({
  value,
  onChange,
  errors = {},
}: {
  value: ReminderTimeValue[];
  onChange: (next: ReminderTimeValue[]) => void;
  errors?: Record<number, string>;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const legendId = `${uid}-legend`;
  const dateRefs = useRef(new Map<string, HTMLInputElement>());
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const addRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<FocusTarget | null>(null);

  // Runs after the render that shows the change, so the target exists.
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    if (target.kind === 'add') addRef.current?.focus();
    else if (target.kind === 'date') dateRefs.current.get(target.key)?.focus();
    else removeRefs.current.get(target.key)?.focus();
  });

  const update = (index: number, patch: Partial<ReminderTimeValue>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const add = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const last = [...value].reverse().find((row) => row.firedAt === null && row.date);
    const key = newRowKey();
    focusNext.current = { kind: 'date', key };
    onChange([
      ...value,
      { key, date: last?.date ?? localDate(tomorrow), time: '09:00', firedAt: null },
    ]);
  };

  // Focus moves to the next row's Remove, or to "+ Add time" when no unfired row follows.
  const remove = (index: number) => {
    const next = value.slice(index + 1).findIndex((row) => row.firedAt === null);
    focusNext.current =
      next === -1
        ? { kind: 'add' }
        : { kind: 'remove', key: rowKey(value[index + 1 + next]!, index + 1 + next) };
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <fieldset className="flex flex-col gap-2.5" aria-labelledby={legendId}>
      <legend id={legendId} className="mb-2.5 text-button font-semibold">
        {t('reminders.fields.times')}
      </legend>
      <ul role="list" className="flex flex-col gap-2">
        {value.map((row, index) => {
          const n = index + 1;
          const fired = row.firedAt !== null;
          const error = errors[index];
          const errorId = `${uid}-error-${index}`;
          const key = rowKey(row, index);
          return (
            <li key={key} className="flex flex-col gap-1.5">
              <div className={cn('flex items-center gap-2', fired && 'text-muted-foreground')}>
                <Input
                  ref={(el) => {
                    if (el) dateRefs.current.set(key, el);
                    else dateRefs.current.delete(key);
                  }}
                  type="date"
                  aria-label={t('reminders.fields.date', { n })}
                  value={row.date}
                  readOnly={fired}
                  aria-invalid={!!error || undefined}
                  aria-describedby={error ? errorId : undefined}
                  onChange={(event) => update(index, { date: event.target.value })}
                  className={cn(
                    'min-w-0 flex-[3] px-3',
                    fired && 'border-transparent bg-muted text-muted-foreground',
                  )}
                />
                <Input
                  type="time"
                  aria-label={t('reminders.fields.time', { n })}
                  value={row.time}
                  readOnly={fired}
                  aria-invalid={!!error || undefined}
                  aria-describedby={error ? errorId : undefined}
                  onChange={(event) => update(index, { time: event.target.value })}
                  className={cn(
                    'min-w-0 flex-[2] px-3',
                    fired && 'border-transparent bg-muted text-muted-foreground',
                  )}
                />
                {fired ? (
                  <span className="w-[38px] shrink-0 text-center text-tiny">
                    {t('reminders.fields.sent')}
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    ref={(el) => {
                      if (el) removeRefs.current.set(key, el);
                      else removeRefs.current.delete(key);
                    }}
                    aria-label={t('reminders.fields.remove', { n })}
                    onClick={() => remove(index)}
                  >
                    <CloseIcon />
                  </Button>
                )}
              </div>
              {error && (
                <p id={errorId} className="text-tiny text-error-ink">
                  {error}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {value.filter((v) => v.firedAt === null).length < KNOWLEDGE_LIMITS.times && (
        <Button
          ref={addRef}
          type="button"
          variant="secondary"
          size="sm"
          onClick={add}
          className="self-start"
        >
          <span aria-hidden="true">+</span>
          {t('reminders.fields.add')}
        </Button>
      )}
    </fieldset>
  );
}
