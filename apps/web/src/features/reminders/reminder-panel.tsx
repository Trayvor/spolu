import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReminderSetDto } from '@spolu/shared';
import { Avatar } from '@/components/avatar';
import { CloseIcon, Icon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth/use-session';
import { CalendarLeaf } from '@/features/knowledge/calendar-leaf';
import { reminderCalendarUrl, subscribeReminder, unsubscribeReminder } from './api';
import { formatReminderDate } from './format';

const CheckIcon = () => (
  <Icon>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

const CalendarIcon = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M16 3v4M8 3v4M3 10h18" />
  </Icon>
);

/** The outline pill that downloads a subject's `.ics` ("Export to calendar"). */
export function CalendarLink({ prefix, subjectId }: { prefix: string; subjectId: string }) {
  const { t } = useTranslation();
  const route = prefix.startsWith('/') ? prefix : `/${prefix}`;
  return (
    <a
      href={reminderCalendarUrl(route, subjectId)}
      download
      className="inline-flex h-8 items-center gap-1.5 rounded-full border-2 border-primary px-4 text-tiny font-semibold text-foreground hover:bg-accent hover:text-foreground touch:h-11"
    >
      <CalendarIcon />
      {t('reminders.panel.addToCalendar')}
    </a>
  );
}

/** Names shown in full before "and N more". */
const SHOWN_NAMES = 3;

/**
 * The reminder block of a subject (a knowledge item; a task in Phase 19): its upcoming times with
 * a calendar leaf, the fired ones muted as "sent", the recipients (author first), the viewer's
 * "Remind me" toggle and the `.ics` download. `prefix` is the subject's API route ("/knowledge",
 * "/tasks"; a missing leading slash is added). `onChanged` refetches the subject after a toggle.
 *
 * Options for subjects edited on their own (tasks, Phase 19); their defaults keep the knowledge
 * rendering: `hideFired`, `timeTag` (a muted tag after a time's date), `onRemoveTime` (a remove
 * button per upcoming time), `children` (under the times: the add row), `recipientsAction` (at the
 * end of the "Reminded" line) and `calendarAvailable` (the `.ics` link without upcoming times, for
 * a task's deadline).
 */
export function ReminderPanel({
  prefix,
  subjectId,
  set,
  authorId,
  onChanged,
  hideFired = false,
  timeTag,
  onRemoveTime,
  children,
  recipientsAction,
  calendarAvailable,
  intro,
  remindedLabel,
  authorMark,
  authorHint,
  unavailableText,
}: {
  prefix: string;
  subjectId: string;
  set: ReminderSetDto;
  authorId: string;
  onChanged: () => void;
  hideFired?: boolean;
  timeTag?: (iso: string) => string | null;
  onRemoveTime?: (id: string) => void;
  children?: ReactNode;
  recipientsAction?: ReactNode;
  calendarAvailable?: boolean;
  /** Under the heading (a task's automatic-reminder line). */
  intro?: ReactNode;
  /** Replaces "Reminded" (a task: "Reminded:"). */
  remindedLabel?: string;
  /** After the author's name in the list (a task: "(set them)"). */
  authorMark?: string;
  /** Replaces "You created this reminder" beside the author's toggle. */
  authorHint?: string;
  /** Replaces "This item has no reminders any more." (`no_reminder_set`). */
  unavailableText?: string;
}) {
  const { t, i18n } = useTranslation();
  const me = useSession();
  const route = prefix.startsWith('/') ? prefix : `/${prefix}`;
  const isAuthor = me?.id === authorId;
  // The toggle answers at once, until the refetched set (a new `set.subscribed`) confirms it.
  const [pending, setPending] = useState<{ value: boolean; base: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const subscribed =
    isAuthor || (pending && pending.base === set.subscribed ? pending.value : set.subscribed);

  const upcoming = set.times
    .filter((time) => time.firedAt === null)
    .sort((a, b) => a.at.localeCompare(b.at));
  const fired = set.times
    .filter((time) => !hideFired && time.firedAt !== null)
    .sort((a, b) => b.at.localeCompare(a.at));
  const recipients = [...set.recipients].sort(
    (a, b) => Number(b.user.id === authorId) - Number(a.user.id === authorId),
  );
  const names = recipients.map((r) =>
    authorMark && r.user.id === authorId ? `${r.user.name} ${authorMark}` : r.user.name,
  );
  const list = (items: string[]) =>
    new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(items);
  const namesText =
    names.length > SHOWN_NAMES
      ? t('reminders.panel.andMore', {
          names: names.slice(0, SHOWN_NAMES).join(', '),
          count: names.length - SHOWN_NAMES,
        })
      : list(names);

  async function toggle() {
    if (busy || isAuthor) return;
    const next = !subscribed;
    setBusy(true);
    setNotice(null);
    setPending({ value: next, base: set.subscribed });
    try {
      await (next ? subscribeReminder : unsubscribeReminder)(route, subjectId);
    } catch (error) {
      setPending(null);
      setNotice(
        error instanceof ApiError && error.code === 'no_reminder_set'
          ? (unavailableText ?? t('reminders.panel.unavailable'))
          : t('reminders.panel.failed'),
      );
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  return (
    <section aria-labelledby={`reminders-${subjectId}`} className="flex flex-col gap-4">
      <h3 id={`reminders-${subjectId}`} className="text-button font-semibold">
        {t('reminders.panel.title')}
      </h3>
      {intro}

      <ul role="list" className="flex flex-col gap-2">
        {upcoming.map((time) => {
          const tag = timeTag?.(time.at) ?? null;
          return (
            <li key={time.id} className="flex items-center gap-3">
              <CalendarLeaf iso={time.at} size={40} />
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="text-button font-semibold">
                  {formatReminderDate(time.at, i18n.language)}
                </span>
                {tag && <span className="text-micro text-muted-foreground">{tag}</span>}
              </span>
              {onRemoveTime && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('reminders.row.remove')}
                  onClick={() => onRemoveTime(time.id)}
                  className="ml-auto size-8 touch:size-11"
                >
                  <CloseIcon />
                </Button>
              )}
            </li>
          );
        })}
        {fired.map((time) => (
          <li key={time.id} className="flex items-center gap-3 text-button text-muted-foreground">
            <span>{formatReminderDate(time.at, i18n.language)}</span>
            <span className="text-micro">{t('reminders.panel.sent')}</span>
          </li>
        ))}
      </ul>

      {children}

      {recipients.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-micro text-muted-foreground">
            {remindedLabel ?? t('reminders.panel.reminded')}
          </span>
          <span className="flex -space-x-1.5" aria-hidden="true">
            {recipients.slice(0, 5).map(({ user }) => (
              <Avatar
                key={user.id}
                userId={user.id}
                name={user.name}
                size={24}
                className="ring-2 ring-popover"
              />
            ))}
          </span>
          <span data-testid="reminder-recipients" className="min-w-0 text-button">
            {namesText}
          </span>
          {recipientsAction}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button
            variant={subscribed ? 'default' : 'secondary'}
            size="sm"
            aria-pressed={subscribed}
            disabled={isAuthor}
            aria-describedby={isAuthor ? `reminders-hint-${subjectId}` : undefined}
            onClick={() => void toggle()}
            className={cn('gap-1.5', isAuthor && 'disabled:opacity-60')}
          >
            {subscribed && <CheckIcon />}
            {t('reminders.panel.remindMe')}
          </Button>
          {isAuthor && (
            <span id={`reminders-hint-${subjectId}`} className="text-micro text-muted-foreground">
              {authorHint ?? t('reminders.panel.authorHint')}
            </span>
          )}
        </div>
        {(calendarAvailable ?? upcoming.length > 0) ? (
          <CalendarLink prefix={route} subjectId={subjectId} />
        ) : (
          <span className="text-micro text-muted-foreground">
            {t('reminders.panel.noUpcoming')}
          </span>
        )}
      </div>

      {notice && (
        <p role="status" className="text-button text-error-ink">
          {notice}
        </p>
      )}
    </section>
  );
}
