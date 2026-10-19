import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { WeeklySummaryListItem } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ListSkeleton } from '@/components/ui/skeleton';
import { useRememberedFilters } from '@/lib/use-remembered-filters';
import { useUpdateSearch } from '@/lib/use-update-search';
import { cn } from '@/lib/utils';
import { summaryListQuery, type ListFilters } from './api';
import { dateTimeLabel, isoWeek, shiftWeek, weekNumber, weekRangeLabel } from './format';
import { StatusChip } from './status-chip';
import { useSummaryEvents } from './use-summary-events';

type Search = { week?: string; scope?: string; status?: string };
const SCOPES = ['mine', 'all'] as const;
const STATUSES = ['review', 'sent', 'all'] as const;

/** A row of pill buttons: one choice of a filter, kept in the URL. */
function Pills<T extends string>({
  label,
  options,
  value,
  text,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  text: (option: T) => string;
  onChange: (option: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Button
          key={option}
          size="sm"
          variant={option === value ? 'default' : 'secondary'}
          aria-pressed={option === value}
          onClick={() => onChange(option)}
        >
          {text(option)}
        </Button>
      ))}
    </div>
  );
}

/**
 * `/weekly-summaries` (spec §12.2): one week's summaries of the admin's clients (or all), with
 * week arrows, the remembered filters, a line for older drafts that were never sent (they stay
 * drafts, the archive lists them) and the link to the archive.
 */
export function WeeklySummaryListPage() {
  const { t, i18n } = useTranslation();
  const update = useUpdateSearch();
  const search = useRememberedFilters(
    'weeklySummaries',
    ['scope', 'status'],
    useSearch({ strict: false }) as Search,
  );
  const week =
    search.week && /^\d{4}-W\d{2}$/.test(search.week) ? search.week : isoWeek(new Date());
  const scope = (SCOPES as readonly string[]).includes(search.scope ?? '')
    ? (search.scope as ListFilters['scope'])
    : 'mine';
  const status = (STATUSES as readonly string[]).includes(search.status ?? '')
    ? (search.status as ListFilters['status'])
    : 'review';
  const list = useInfiniteQuery(summaryListQuery({ week, scope, status }));
  useSummaryEvents();
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const olderDrafts = list.data?.pages[0]?.olderDrafts ?? 0;
  const set = (key: keyof Search, value: string) =>
    update((next) => void (next[key] = value), { replace: key !== 'week' });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 min-[641px]:flex-row min-[641px]:items-start min-[641px]:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-medium leading-tight font-semibold">
            {t('weeklySummary.list.title')}
          </h1>
          <p className="text-button text-muted-foreground tabular-nums">
            {t('weeklySummary.list.subtitle', {
              week: weekNumber(week),
              range: weekRangeLabel(i18n.language, week),
            })}
          </p>
        </div>
        <Link
          to="/weekly-summaries/archive"
          className="self-start text-button font-semibold underline-offset-4 hover:underline"
        >
          {t('weeklySummary.list.archive')}
        </Link>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => set('week', shiftWeek(week, -1))}>
            {t('weeklySummary.list.previousWeek')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => set('week', shiftWeek(week, 1))}>
            {t('weeklySummary.list.nextWeek')}
          </Button>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Pills
            label={t('weeklySummary.list.scopeLabel')}
            options={SCOPES}
            value={scope}
            text={(o) => t(`weeklySummary.list.scope.${o}`)}
            onChange={(o) => set('scope', o)}
          />
          <Pills
            label={t('weeklySummary.list.statusLabel')}
            options={STATUSES}
            value={status}
            text={(o) => t(`weeklySummary.list.status.${o}`)}
            onChange={(o) => set('status', o)}
          />
        </div>
      </div>

      {olderDrafts > 0 && (
        <p className="text-button">
          {t('weeklySummary.list.olderDrafts', { count: olderDrafts })}{' '}
          <Link
            to="/weekly-summaries/archive"
            search={{ status: 'unsent' } as never}
            className="font-semibold underline underline-offset-4"
          >
            {t('weeklySummary.list.showOlder')}
          </Link>
        </p>
      )}

      {list.isError && (
        <p role="alert" className="text-button text-error-ink">
          {t('errors.generic')}
        </p>
      )}
      {list.isPending && <ListSkeleton rows={3} rowClassName="min-h-[72px]" />}
      {list.isSuccess && items.length === 0 && (
        <Card className="px-5 text-button text-muted-foreground">
          {t('weeklySummary.list.empty')}
        </Card>
      )}
      {items.length > 0 && (
        <Card className="gap-0 py-0">
          <ul role="list">
            {items.map((item) => (
              <SummaryRow key={item.id} item={item} language={i18n.language} />
            ))}
          </ul>
        </Card>
      )}
      {list.hasNextPage && (
        <Button
          variant="secondary"
          className="self-start"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('weeklySummary.list.more')}
        </Button>
      )}
    </div>
  );
}

function SummaryRow({ item, language }: { item: WeeklySummaryListItem; language: string }) {
  const { t } = useTranslation();
  const facts = item.status === 'preparing' || item.source === null ? null : item.source;
  return (
    <li
      className={cn(
        'relative flex flex-col gap-1.5 px-5 py-4',
        '[&:not(:last-child)]:border-b [&:not(:last-child)]:border-border',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          to="/weekly-summaries/$summaryId"
          params={{ summaryId: item.id }}
          className="min-w-0 font-semibold break-words after:absolute after:inset-0 hover:underline"
        >
          {item.groupName}
        </Link>
        <StatusChip status={item.status} skipReason={item.skipReason} />
        {facts && (
          <span className="text-micro text-muted-foreground">
            {t(facts === 'ai' ? 'weeklySummary.list.ai' : 'weeklySummary.list.factsOnly')}
          </span>
        )}
      </div>
      <p className="text-micro text-muted-foreground tabular-nums">
        {t('weeklySummary.list.items', { count: item.itemCount })} ·{' '}
        {t('weeklySummary.list.recipients', { count: item.recipientCount })} ·{' '}
        {t('weeklySummary.list.changed', { date: dateTimeLabel(language, item.updatedAt) })}
      </p>
    </li>
  );
}
