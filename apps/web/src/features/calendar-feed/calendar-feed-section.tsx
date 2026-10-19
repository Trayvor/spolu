import { useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { CalendarFeed, CalendarFeedAnswer, CalendarFeedInclude } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { Toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';
import { calendarFeedQuery, deleteCalendarFeed, putCalendarFeed, rotateCalendarFeed } from './api';

const DEFAULT_INCLUDE: CalendarFeedInclude = { events: true, tasks: true, calls: true };
const KINDS = [
  ['events', 'events'],
  ['tasks', 'myTasks'],
  ['calls', 'calls'],
] as const;

/**
 * "Kalendár" on /settings (ADR 0051): the person's calendar subscription link for Google,
 * Outlook or Apple, what it shows, and rotating or cancelling it. For admins and clients; a
 * žiadateľ gets 403 and sees no card. A lazy chunk with its own namespace `calendarFeed`.
 */
export function CalendarFeedSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const feed = useQuery(calendarFeedQuery);
  const [include, setInclude] = useState<CalendarFeedInclude>(DEFAULT_INCLUDE);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<'rotate' | 'revoke' | null>(null);

  if (feed.isError && feed.error instanceof ApiError && feed.error.status === 403) return null;

  const current = feed.data?.feed ?? null;
  const shown = current ? current.include : include;

  async function run(action: () => Promise<CalendarFeedAnswer | void>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      const answer = await action();
      queryClient.setQueryData(calendarFeedQuery.queryKey, answer ?? { feed: null });
      after?.();
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 429 ? t('calendarFeed.tooMany') : t('errors.generic'),
      );
    } finally {
      setBusy(false);
    }
  }

  function toggle(key: keyof CalendarFeedInclude, value: boolean) {
    const next = { ...shown, [key]: value };
    if (!current) {
      setInclude(next);
      return;
    }
    setSaved(false);
    void run(
      () => putCalendarFeed(next),
      () => setSaved(true),
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('calendarFeed.title')}</h2>
        </CardTitle>
        <p className="text-tiny text-muted-foreground">{t('calendarFeed.intro')}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {feed.isPending && <div className="h-24" aria-hidden />}
        {current && <FeedLink feed={current} />}
        {!feed.isPending && (
          <fieldset className="flex flex-col gap-2" disabled={busy && !current}>
            <legend className="mb-2 font-semibold">{t('calendarFeed.show')}</legend>
            {KINDS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={shown[key]}
                  onChange={(e) => toggle(key, e.target.checked)}
                  className="size-5 shrink-0 accent-foreground"
                />
                <span>{t(`calendarFeed.${label}`)}</span>
              </label>
            ))}
            {saved && (
              <p role="status" className="text-micro text-muted-foreground">
                {t('calendarFeed.saved')}
              </p>
            )}
          </fieldset>
        )}
        {!feed.isPending && !current && (
          <Button
            type="button"
            size="lg"
            className="self-start"
            disabled={busy}
            onClick={() => void run(() => putCalendarFeed(include))}
          >
            {t('calendarFeed.create')}
          </Button>
        )}
        {current && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setAsking('rotate')}
            >
              {t('calendarFeed.rotate')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setAsking('revoke')}
            >
              {t('calendarFeed.revoke')}
            </Button>
          </div>
        )}
      </CardContent>
      {asking && (
        <ConfirmSheet
          kind={asking}
          busy={busy}
          onCancel={() => setAsking(null)}
          onConfirm={() =>
            void run(asking === 'rotate' ? rotateCalendarFeed : deleteCalendarFeed, () => {
              setAsking(null);
              setSaved(false);
            })
          }
        />
      )}
      {error && <Toast onClose={() => setError(null)}>{error}</Toast>}
    </Card>
  );
}

/** The link, its copy button, the two "add" links, the warning and the last fetch. */
function FeedLink({ feed }: { feed: CalendarFeed }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [copied, setCopied] = useState(false);
  const format = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  const linkClass = buttonVariants({ variant: 'secondary' });

  async function copy() {
    try {
      await navigator.clipboard.writeText(feed.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-link`} className="flex flex-col gap-3">
      <h3 id={`${id}-link`} className="font-semibold">
        {t('calendarFeed.link')}
      </h3>
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={feed.url}
          aria-labelledby={`${id}-link`}
          className="min-w-0 flex-1 font-mono text-tiny"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button type="button" variant="secondary" onClick={() => void copy()}>
          {copied ? t('calendarFeed.copied') : t('calendarFeed.copy')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={feed.googleUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
          {t('calendarFeed.google')}
        </a>
        <a href={feed.webcalUrl} rel="noopener noreferrer" className={linkClass}>
          {t('calendarFeed.apple')}
        </a>
      </div>
      <p className="text-tiny">{t('calendarFeed.warning')}</p>
      <p className="text-tiny text-muted-foreground">
        {feed.lastFetchedAt
          ? t('calendarFeed.lastFetched', { when: format.format(new Date(feed.lastFetchedAt)) })
          : t('calendarFeed.neverFetched')}
      </p>
    </section>
  );
}

/** Asks before a new link (the old one stops working) or before cancelling the subscription. */
function ConfirmSheet({
  kind,
  busy,
  onConfirm,
  onCancel,
}: {
  kind: 'rotate' | 'revoke';
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <SheetDialog compact onEscape={onCancel} initialFocus={cancel}>
      <div className="flex flex-col gap-3 p-4 min-[641px]:px-6 min-[641px]:py-5">
        <SheetDialogTitle className="text-medium font-semibold">
          {t(`calendarFeed.${kind}Title`)}
        </SheetDialogTitle>
        <p>{t(`calendarFeed.${kind}Text`)}</p>
      </div>
      <footer className="flex flex-wrap gap-2 border-t-2 border-border px-4 py-3 min-[641px]:px-6">
        <Button type="button" variant="destructive" disabled={busy} onClick={onConfirm}>
          {t(kind === 'rotate' ? 'calendarFeed.rotate' : 'calendarFeed.revoke')}
        </Button>
        <Button ref={cancel} type="button" variant="ghost" onClick={onCancel}>
          {t(kind === 'rotate' ? 'calendarFeed.cancel' : 'calendarFeed.back')}
        </Button>
      </footer>
    </SheetDialog>
  );
}
