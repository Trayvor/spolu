import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReminderSetDto } from '@spolu/shared';
import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icons';
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

/** Names shown in full before "and N more". */
const SHOWN_NAMES = 3;

/**
 * The reminder block of a subject (a knowledge item; a task in Phase 19): its upcoming times with
 * a calendar leaf, the fired ones muted as "sent", the recipients (author first), the viewer's
 * "Remind me" toggle and the `.ics` download. `prefix` is the subject's API route ("/knowledge",
 * "/tasks"; a missing leading slash is added). `onChanged` refetches the subject after a toggle.
 */
export function ReminderPanel({
  prefix,
  subjectId,
  set,
  authorId,
  onChanged,
}: {
  prefix: string;
  subjectId: string;
  set: ReminderSetDto;
  authorId: string;
  onChanged: () => void;
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
    .filter((time) => time.firedAt !== null)
    .sort((a, b) => b.at.localeCompare(a.at));
  const recipients = [...set.recipients].sort(
    (a, b) => Number(b.user.id === authorId) - Number(a.user.id === authorId),
  );
  const names = recipients.map((r) => r.user.name);
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
          ? t('reminders.panel.unavailable')
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

      <ul className="flex flex-col gap-2">
        {upcoming.map((time) => (
          <li key={time.id} className="flex items-center gap-3">
            <CalendarLeaf iso={time.at} size={40} />
            <span className="text-button font-semibold">
              {formatReminderDate(time.at, i18n.language)}
            </span>
          </li>
        ))}
        {fired.map((time) => (
          <li key={time.id} className="flex items-center gap-3 text-button text-muted-foreground">
            <span>{formatReminderDate(time.at, i18n.language)}</span>
            <span className="text-micro">{t('reminders.panel.sent')}</span>
          </li>
        ))}
      </ul>

      {recipients.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-micro text-muted-foreground">{t('reminders.panel.reminded')}</span>
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
              {t('reminders.panel.authorHint')}
            </span>
          )}
        </div>
        {upcoming.length > 0 ? (
          <a
            href={reminderCalendarUrl(route, subjectId)}
            download
            className="inline-flex h-8 items-center gap-1.5 rounded-full border-2 border-primary px-4 text-tiny font-semibold text-foreground hover:bg-accent hover:text-foreground"
          >
            <CalendarIcon />
            {t('reminders.panel.addToCalendar')}
          </a>
        ) : (
          <Button variant="outline" size="sm" disabled className="gap-1.5">
            <CalendarIcon />
            {t('reminders.panel.noUpcoming')}
          </Button>
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
