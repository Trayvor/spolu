import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { localToIso } from './reminder-times-field';

/**
 * The inline row that adds one reminder time to a subject edited on its own (a task): a native
 * date input (`defaultDate`) and a time input (09:00), "Add" and "Cancel". Enter adds. `onAdd`
 * gets the ISO instant of the local date and time; `error` (a time that passed) shows under the
 * row. Needs the `reminders` locale namespace.
 */
export function AddReminderRow({
  defaultDate,
  onAdd,
  onCancel,
  error,
  busy = false,
}: {
  defaultDate: string;
  onAdd: (iso: string) => void;
  onCancel: () => void;
  error?: string;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('09:00');
  const dateRef = useRef<HTMLInputElement>(null);
  const iso = localToIso(date, time);
  const errorId = `${uid}-error`;

  useEffect(() => dateRef.current?.focus(), []);

  const add = () => {
    if (iso && !busy) onAdd(iso);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      add();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };
  const field = {
    onKeyDown,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId : undefined,
    className: 'min-w-0 px-3 touch:h-11',
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          ref={dateRef}
          type="date"
          aria-label={t('reminders.row.date')}
          value={date}
          onChange={(event) => setDate(event.target.value)}
          {...field}
          className={`flex-[3] basis-36 ${field.className}`}
        />
        <Input
          type="time"
          aria-label={t('reminders.row.time')}
          value={time}
          onChange={(event) => setTime(event.target.value)}
          {...field}
          className={`flex-[2] basis-24 ${field.className}`}
        />
        <div className="flex gap-2 max-[640px]:w-full">
          <Button
            type="button"
            size="sm"
            disabled={!iso || busy}
            onClick={add}
            className="max-[640px]:h-11 max-[640px]:flex-1"
          >
            {t('reminders.row.confirm')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="max-[640px]:h-11 max-[640px]:flex-1"
          >
            {t('reminders.row.cancel')}
          </Button>
        </div>
      </div>
      {error && (
        <p id={errorId} className="text-tiny text-error-ink">
          {error}
        </p>
      )}
    </div>
  );
}
