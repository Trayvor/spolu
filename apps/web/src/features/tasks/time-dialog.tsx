import { useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { LONG_ENTRY_MINUTES, formatDuration, parseDuration } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { groupQuery } from '@/features/groups/api';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { saveMyTaskTime, saveMyTicketTime, taskTimeQuery, ticketTimeQuery } from './time-api';
import type { TimeAsk } from './time-queue';

/** The quick choices (spec §5.2), in minutes; 0 ("No time") is a chip of its own. */
export const TIME_CHIPS = [15, 30, 60, 120, 240] as const;

/** "1 h 30 min" in the UI language's units. */
export function formatMinutes(t: TFunction, minutes: number): string {
  return formatDuration(minutes, {
    hours: t('tasks.time.units.hours'),
    minutes: t('tasks.time.units.minutes'),
  });
}

/** What the field shows for saved minutes: `1:30`, which `parseDuration` reads in any language. */
export const clockOf = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * The time dialog (Phase 32, spec §5.2 and §5.6): "How much time did you spend?" with the task's
 * (or ticket's) title and client, a duration field (`1:30`, `1,5`, `90m`, `2h 15m`), quick chips
 * and "No time" (0). Above 12 h it asks "Correct?"; above 100 h the field is refused. For a ticket
 * whose linked tasks hold logged time it offers (a) time for the ticket, added to the tasks'
 * hours, or (b) "the hours on the linked tasks cover it". Save writes the caller's own entry;
 * Later closes and leaves the request (the dashboard row). A sheet on phones. Its own lazy chunk.
 */
export function TimeDialog({ ask, onDone }: { ask: TimeAsk; onDone: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const titleId = useId();
  const fieldId = useId();
  const field = useRef<HTMLInputElement>(null);
  const taskTime = useQuery({ ...taskTimeQuery(ask.id), enabled: ask.kind === 'task' });
  const ticketTime = useQuery({ ...ticketTimeQuery(ask.id), enabled: ask.kind === 'ticket' });
  const { data: group } = useQuery({
    ...groupQuery(ask.groupId ?? ''),
    enabled: ask.groupId !== null,
  });
  const mine = ask.kind === 'task' ? taskTime.data?.mine : ticketTime.data?.mine;
  const ticket = ask.kind === 'ticket' ? ticketTime.data : undefined;

  // Typed text wins; until then the saved minutes (a later edit), once they arrive.
  const [typed, setTyped] = useState<string | null>(null);
  const [choice, setChoice] = useState<'ticket' | 'covered' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const savedCovered =
    mine !== null && mine !== undefined && 'coveredByTasks' in mine && mine.coveredByTasks;
  const saved = savedCovered ? null : (mine?.minutes ?? null);
  const text = typed ?? (saved !== null ? clockOf(saved) : '');
  const minutes = parseDuration(text);
  const offersCovered = ticket?.linkedTasksLogged === true;
  const covered = offersCovered && (choice ?? (savedCovered ? 'covered' : 'ticket')) === 'covered';

  const pick = (value: number) => {
    setTyped(clockOf(value));
    setChoice('ticket');
    setError(null);
  };

  async function save() {
    if (busy) return;
    if (!covered && minutes === null) {
      setError(t('tasks.time.invalid'));
      field.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (ask.kind === 'task') await saveMyTaskTime(queryClient, ask.id, minutes!);
      else {
        await saveMyTicketTime(
          queryClient,
          ask.id,
          covered ? { coveredByTasks: true } : { minutes: minutes! },
        );
      }
      onDone();
    } catch (err) {
      // Gone, or no longer an assignee: nothing left to ask.
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) onDone();
      else {
        setError(t('tasks.time.saveFailed'));
        setBusy(false);
      }
    }
  }

  const heading =
    ask.kind === 'task'
      ? t('tasks.time.title')
      : t('tasks.time.ticketTitle', { ticket: ask.title });
  const invalid = text.trim() !== '' && minutes === null;

  return (
    <SheetDialog
      compact
      onEscape={onDone}
      labelledBy={titleId}
      initialFocus={field}
      testId="time-dialog"
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5 min-[641px]:px-6">
          <div className="flex flex-col gap-1">
            <SheetDialogTitle asChild>
              <h2 id={titleId} className="text-medium leading-tight font-semibold break-words">
                {heading}
              </h2>
            </SheetDialogTitle>
            <p className="text-button break-words text-muted-foreground">
              {[ask.kind === 'task' ? ask.title : null, group?.name].filter(Boolean).join(' · ')}
            </p>
          </div>

          {offersCovered && (
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">{t('tasks.time.options')}</legend>
              <Choice
                name={`${fieldId}-choice`}
                checked={!covered}
                onChange={() => setChoice('ticket')}
                label={t('tasks.time.optionTicket')}
                hint={t('tasks.time.optionTicketHint')}
              />
              <Choice
                name={`${fieldId}-choice`}
                checked={covered}
                onChange={() => {
                  setChoice('covered');
                  setError(null);
                }}
                label={t('tasks.time.optionCovered')}
                hint={t('tasks.time.optionCoveredHint')}
              />
            </fieldset>
          )}

          <div className={cn('flex flex-col gap-3', covered && 'text-muted-foreground')}>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={fieldId} className="text-micro font-semibold">
                {t('tasks.time.duration')}
              </label>
              <Input
                id={fieldId}
                ref={field}
                inputMode="text"
                autoComplete="off"
                placeholder="1:30"
                disabled={covered}
                value={text}
                aria-invalid={invalid || (error !== null && !covered) || undefined}
                aria-describedby={`${fieldId}-hint`}
                onChange={(event) => {
                  setTyped(event.target.value);
                  setChoice('ticket');
                  setError(null);
                }}
                className="text-medium tabular-nums"
              />
              <p
                id={`${fieldId}-hint`}
                className="text-micro text-muted-foreground"
                aria-live="polite"
              >
                {minutes !== null && text.trim() !== ''
                  ? t('tasks.time.readback', { value: formatMinutes(t, minutes) })
                  : t('tasks.time.hint')}
              </p>
            </div>
            <div role="group" aria-label={t('tasks.time.chips')} className="flex flex-wrap gap-2">
              {TIME_CHIPS.map((value) => (
                <Chip
                  key={value}
                  pressed={!covered && minutes === value && text.trim() !== ''}
                  disabled={covered}
                  onClick={() => pick(value)}
                >
                  {formatMinutes(t, value)}
                </Chip>
              ))}
              <Chip
                pressed={!covered && minutes === 0 && text.trim() !== ''}
                disabled={covered}
                onClick={() => pick(0)}
              >
                {t('tasks.time.none')}
              </Chip>
            </div>
            {!covered && minutes !== null && minutes > LONG_ENTRY_MINUTES && (
              <p className="flex items-center gap-2 text-button" role="status">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-foreground" />
                {t('tasks.time.long')}
              </p>
            )}
          </div>

          {ticket && ticket.linkedTasks.length > 0 && (
            <div className="flex flex-col gap-2 border-t-2 border-border pt-4">
              <p className="text-micro font-semibold">{t('tasks.time.linkedTasks')}</p>
              <ul role="list" className="flex flex-col gap-1">
                {ticket.linkedTasks.map((task) => (
                  <li
                    key={task.taskId}
                    className="flex items-baseline justify-between gap-3 text-button"
                  >
                    <span className="min-w-0 truncate">{task.title}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {task.mine === null ? t('tasks.time.notFilled') : formatMinutes(t, task.mine)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <p role="alert" className="text-button text-error-ink">
              {error}
            </p>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-border px-5 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] min-[641px]:flex-row min-[641px]:justify-end min-[641px]:px-6">
          <Button type="button" variant="ghost" onClick={onDone}>
            {t('tasks.time.later')}
          </Button>
          <Button type="submit" disabled={busy}>
            {t('tasks.time.save')}
          </Button>
        </div>
      </form>
    </SheetDialog>
  );
}

function Chip({
  pressed,
  disabled,
  onClick,
  children,
}: {
  pressed: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'h-8 rounded-full px-3.5 text-tiny font-semibold tabular-nums transition-colors duration-(--duration-fast) disabled:opacity-50',
        pressed
          ? 'bg-primary text-primary-foreground'
          : 'bg-secondary text-secondary-foreground hover:bg-surface-3',
      )}
    >
      {children}
    </button>
  );
}

function Choice({
  name,
  checked,
  onChange,
  label,
  hint,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  hint: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-md border-2 px-4 py-3',
        checked ? 'border-foreground' : 'border-border hover:border-input',
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="mt-1 size-4 shrink-0 accent-[var(--foreground)]"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-button font-semibold">{label}</span>
        <span className="text-micro text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
