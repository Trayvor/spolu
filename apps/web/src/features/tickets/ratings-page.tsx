import { useState, type ReactNode } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TicketRatingListItem, TicketRatingSummary } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { groupsQuery, onlyClientGroups } from '@/features/groups/api';
import { formatCreated } from '@/features/tasks/dates';
import { useRememberedFilters } from '@/lib/use-remembered-filters';
import { useUpdateSearch } from '@/lib/use-update-search';
import { cn } from '@/lib/utils';
import { CheckIcon, ChevronLeft, ThumbDown, ThumbUp } from './icons';
import { ratingSummaryQuery, ratingsListQuery, type RatingFilter } from './ratings-api';
import { validateRatingsSearch } from './ratings-search';

const REMEMBERED_KEYS = ['days', 'groupId', 'value'] as const;
const PERIODS = [30, 90, 365] as const;

/** The filter in the URL, remembered for the next visit like the other lists. */
function useRatingFilter(): [RatingFilter, (next: RatingFilter) => void] {
  const search = useRememberedFilters(
    'ticketRatings',
    REMEMBERED_KEYS,
    validateRatingsSearch(useSearch({ strict: false }) as Record<string, unknown>),
  );
  const update = useUpdateSearch();
  const filter: RatingFilter = {
    days: search.days ?? 30,
    groupId: search.groupId,
    value: search.value,
  };
  const set = (next: RatingFilter) =>
    update(
      (s) => {
        const put = (key: string, value: unknown) => {
          if (value === undefined) delete s[key];
          else s[key] = value;
        };
        put('days', next.days === 30 ? undefined : next.days);
        put('groupId', next.groupId);
        put('value', next.value);
      },
      { replace: false },
    );
  return [filter, set];
}

/**
 * `/tickets/ratings` (admins, 2026-10-19): how the requesters rated resolved tickets. Period,
 * client and value filters, the four totals of the period, and the ratings newest first with
 * their comments as plain text. Every client by default, so every admin sees the same numbers.
 */
export function RatingsPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useRatingFilter();
  const clients = useQuery({ ...groupsQuery, select: onlyClientGroups }).data ?? [];
  const summary = useQuery(ratingSummaryQuery({ days: filter.days, groupId: filter.groupId }));
  const list = useInfiniteQuery(ratingsListQuery(filter));
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          to="/tickets"
          className="inline-flex min-h-11 items-center gap-1.5 self-start text-tiny font-semibold text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft />
          {t('ticketRatings.back')}
        </Link>
        <h1 className="text-medium leading-tight font-semibold">{t('ticketRatings.title')}</h1>
      </header>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Pills label={t('ticketRatings.period.label')}>
          {PERIODS.map((days) => (
            <Pill
              key={days}
              pressed={filter.days === days}
              onClick={() => setFilter({ ...filter, days })}
            >
              {t(`ticketRatings.period.${days}`)}
            </Pill>
          ))}
        </Pills>
        <Select
          aria-label={t('ticketRatings.client.label')}
          value={filter.groupId ?? ''}
          onChange={(e) => setFilter({ ...filter, groupId: e.target.value || undefined })}
          className="h-8 py-0 text-tiny"
        >
          <option value="">{t('ticketRatings.client.all')}</option>
          {clients.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
        <Pills label={t('ticketRatings.value.label')}>
          {([undefined, 'up', 'down'] as const).map((value) => (
            <Pill
              key={value ?? 'all'}
              pressed={filter.value === value}
              onClick={() => setFilter({ ...filter, value })}
            >
              {t(`ticketRatings.value.${value ?? 'all'}`)}
            </Pill>
          ))}
        </Pills>
      </div>

      <SummaryRow summary={summary.data} />

      {list.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-xl bg-card p-5">
          <p className="text-button">{t('ticketRatings.error')}</p>
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            {t('ticketRatings.retry')}
          </Button>
        </div>
      ) : list.isPending ? (
        <p role="status" className="text-button text-muted-foreground">
          {t('tickets.list.loading')}
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-xl bg-card p-5 text-button text-muted-foreground">
          {t('ticketRatings.empty')}
        </p>
      ) : (
        <ul className="flex flex-col divide-y-2 divide-border rounded-xl bg-card">
          {items.map((item) => (
            <RatingRow key={`${item.ticketId}:${item.raterId}`} item={item} />
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <Button
          variant="outline"
          className="self-center"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? t('tickets.list.loading') : t('ticketRatings.more')}
        </Button>
      )}
    </div>
  );
}

function Pills({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {children}
    </div>
  );
}

function Pill({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-tiny font-semibold before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-['']",
        pressed
          ? 'bg-primary pl-3 text-primary-foreground'
          : 'bg-secondary text-secondary-foreground hover:bg-surface-3',
      )}
    >
      {pressed && <CheckIcon />}
      {children}
    </button>
  );
}

/** The four totals; the shares are computed here from the exact counts. */
function SummaryRow({ summary }: { summary: TicketRatingSummary | undefined }) {
  const { t, i18n } = useTranslation();
  const percent = (part: number, whole: number) =>
    whole === 0
      ? '–'
      : new Intl.NumberFormat(i18n.language, { style: 'percent' }).format(part / whole);
  const rated = summary ? summary.up + summary.down : 0;
  const cells: { label: string; value: string; hint?: string }[] = [
    { label: t('ticketRatings.summary.up'), value: summary ? String(summary.up) : '–' },
    { label: t('ticketRatings.summary.down'), value: summary ? String(summary.down) : '–' },
    {
      label: t('ticketRatings.summary.satisfaction'),
      value: summary ? percent(summary.up, rated) : '–',
    },
    {
      label: t('ticketRatings.summary.response'),
      value: summary ? percent(summary.rated, summary.resolved) : '–',
      hint: t('ticketRatings.summary.responseHint'),
    },
  ];
  return (
    <dl
      aria-busy={summary === undefined}
      className="grid grid-cols-2 gap-3 min-[641px]:grid-cols-4"
    >
      {cells.map((cell) => (
        <div key={cell.label} className="flex flex-col gap-1 rounded-xl bg-card p-4">
          <dt className="text-micro font-semibold text-muted-foreground">{cell.label}</dt>
          <dd className="text-medium leading-tight font-semibold tabular-nums">{cell.value}</dd>
          {cell.hint && <dd className="text-micro text-muted-foreground">{cell.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

function RatingRow({ item }: { item: TicketRatingListItem }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const meta = [item.groupName, item.raterName, formatCreated(item.ratedAt, i18n.language)]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className="flex gap-3 p-4">
      <span
        className={cn('mt-0.5', item.value === 'down' ? 'text-error-ink' : 'text-foreground')}
        title={t(`ticketRatings.value.${item.value}`)}
      >
        {item.value === 'up' ? <ThumbUp /> : <ThumbDown />}
        <span className="sr-only">{t(`ticketRatings.value.${item.value}`)}</span>
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          to="/tickets/$ticketId"
          params={{ ticketId: item.ticketId }}
          className="text-button font-semibold break-words underline-offset-4 hover:underline"
        >
          #{item.number} {item.subject || t('tickets.row.noSubject')}
        </Link>
        <span className="text-tiny text-muted-foreground">{meta}</span>
        {item.comment && (
          <button
            type="button"
            aria-expanded={open}
            title={t(open ? 'ticketRatings.comment.collapse' : 'ticketRatings.comment.expand')}
            onClick={() => setOpen(!open)}
            className={cn(
              'text-left text-button whitespace-pre-line break-words',
              !open && 'line-clamp-3',
            )}
          >
            {item.comment}
          </button>
        )}
      </div>
    </li>
  );
}
