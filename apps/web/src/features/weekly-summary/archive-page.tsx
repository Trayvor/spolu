import { useEffect, useId, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { WeeklySummaryArchiveItem } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ListSkeleton } from '@/components/ui/skeleton';
import { useUpdateSearch } from '@/lib/use-update-search';
import { archiveQuery, groupOptionsQuery, type ArchiveFilters } from './api';
import { ContentView, highlight } from './content-view';
import { dateLabel, rangeLabel, weekNumber } from './format';
import { StatusChip } from './status-chip';
import { useSummaryEvents } from './use-summary-events';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['all', 'sent', 'unsent'] as const;
type Search = { groupId?: string; from?: string; to?: string; q?: string; status?: string };

/** `value`, once it stayed the same for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** The URL's filters, the invalid ones dropped (the server would answer 400). */
function filtersOf(search: Search): ArchiveFilters {
  const from = search.from && DAY.test(search.from) ? search.from : undefined;
  const to = search.to && DAY.test(search.to) ? search.to : undefined;
  const q = search.q && search.q.trim().length >= 2 ? search.q.trim().slice(0, 100) : undefined;
  return {
    groupId: search.groupId || undefined,
    from,
    to: from && to && from > to ? undefined : to,
    q,
    status: (STATUSES as readonly string[]).includes(search.status ?? '')
      ? (search.status as ArchiveFilters['status'])
      : 'all',
  };
}

/**
 * `/weekly-summaries/archive` (spec §12.8): every weekly report of every client, sent or not,
 * newest first, filtered by client, days and text; the filters live in the URL so a search can
 * be shared with another admin. Matches are marked in the escaped text.
 */
export function WeeklySummaryArchivePage() {
  const { t } = useTranslation();
  const update = useUpdateSearch();
  const search = useSearch({ strict: false }) as Search;
  const filters = filtersOf(search);
  const [text, setText] = useState(search.q ?? '');
  const debounced = useDebounced(text, 300);
  useEffect(() => {
    if ((search.q ?? '') === debounced) return;
    update((next) => void (next.q = debounced || undefined), { replace: true });
  }, [debounced, search.q, update]);
  const list = useInfiniteQuery(archiveQuery(filters));
  useSummaryEvents();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const set = (key: keyof Search, value: string | undefined) =>
    update((next) => void (next[key] = value || undefined), { replace: true });
  const textId = useId();

  return (
    <div className="flex max-w-[860px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          to="/weekly-summaries"
          className="self-start text-button font-medium text-muted-foreground hover:text-foreground"
        >
          {t('weeklySummary.archive.back')}
        </Link>
        <h1 className="text-medium leading-tight font-semibold">
          {t('weeklySummary.archive.title')}
        </h1>
        <p className="max-w-[60ch] text-button text-muted-foreground">
          {t('weeklySummary.archive.subtitle')}
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-xl bg-card p-5">
        <GroupPicker
          value={filters.groupId}
          name={items.find((i) => i.groupId === filters.groupId)}
          onChange={(id) => set('groupId', id)}
        />
        <div className="grid gap-4 min-[641px]:grid-cols-2">
          <label className="flex flex-col gap-1 text-button font-semibold">
            {t('weeklySummary.archive.from')}
            <Input
              type="date"
              value={filters.from ?? ''}
              onChange={(e) => set('from', e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-button font-semibold">
            {t('weeklySummary.archive.to')}
            <Input
              type="date"
              value={filters.to ?? ''}
              onChange={(e) => set('to', e.target.value)}
            />
          </label>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={textId} className="text-button font-semibold">
            {t('weeklySummary.archive.search')}
          </label>
          <Input
            id={textId}
            type="search"
            value={text}
            maxLength={100}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div
          role="group"
          aria-label={t('weeklySummary.archive.statusLabel')}
          className="flex flex-wrap gap-2"
        >
          {STATUSES.map((status) => (
            <Button
              key={status}
              size="sm"
              variant={filters.status === status ? 'default' : 'secondary'}
              aria-pressed={filters.status === status}
              onClick={() => set('status', status === 'all' ? undefined : status)}
            >
              {t(`weeklySummary.archive.status.${status}`)}
            </Button>
          ))}
        </div>
      </div>

      {list.isError && (
        <p role="alert" className="text-button text-error-ink">
          {t('errors.generic')}
        </p>
      )}
      {list.isPending && <ListSkeleton rows={3} rowClassName="min-h-[160px]" />}
      {list.isSuccess && items.length === 0 && (
        <Card className="px-5 text-button text-muted-foreground">
          {t('weeklySummary.archive.empty')}
        </Card>
      )}
      <ul role="list" className="flex flex-col gap-4">
        {items.map((item) => (
          <ArchiveCard key={item.id} item={item} q={filters.q} />
        ))}
      </ul>
      {list.hasNextPage && (
        <Button
          variant="secondary"
          className="self-start"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('weeklySummary.archive.more')}
        </Button>
      )}
    </div>
  );
}

function ArchiveCard({ item, q }: { item: WeeklySummaryArchiveItem; q?: string }) {
  const { t, i18n } = useTranslation();
  const range = rangeLabel(i18n.language, new Date(item.windowStart), new Date(item.windowEnd));
  return (
    <li>
      <Card className="gap-3 px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-body font-semibold">
            {item.groupDeactivated
              ? t('weeklySummary.archive.deactivated', { name: item.groupName })
              : item.groupName}
          </h2>
          <StatusChip status={item.status} skipReason={item.skipReason} />
          <Link
            to="/weekly-summaries/$summaryId"
            params={{ summaryId: item.id }}
            className="ml-auto text-button font-semibold underline-offset-4 hover:underline"
          >
            {t('weeklySummary.archive.open')}
          </Link>
        </div>
        <p className="text-micro text-muted-foreground tabular-nums">
          {t('weeklySummary.list.subtitle', { week: weekNumber(item.week), range })} ·{' '}
          {item.status === 'sent' && item.sentAt
            ? t('weeklySummary.archive.sentBy', {
                date: dateLabel(i18n.language, item.sentAt),
                name: item.sentBy?.name ?? '–',
              })
            : t('weeklySummary.archive.unsent')}
        </p>
        <ContentView content={item.content} mark={q ? (text) => highlight(text, q) : undefined} />
      </Card>
    </li>
  );
}

/** "Klient": all clients by default; typing lists up to 20 by name, deactivated ones marked. */
function GroupPicker({
  value,
  name,
  onChange,
}: {
  value?: string;
  name?: WeeklySummaryArchiveItem;
  onChange: (groupId: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q, 300);
  const options = useQuery({ ...groupOptionsQuery(debounced), enabled: open });
  const id = useId();
  const label = (o: { name: string; deactivated: boolean }) =>
    o.deactivated ? t('weeklySummary.archive.deactivated', { name: o.name }) : o.name;
  const chosen =
    value === undefined
      ? null
      : (options.data?.items.find((o) => o.id === value) ??
        (name ? { name: name.groupName, deactivated: name.groupDeactivated } : null));
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-button font-semibold">
        {t('weeklySummary.archive.client')}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-button">
          {value === undefined
            ? t('weeklySummary.archive.allClients')
            : chosen
              ? label(chosen)
              : t('weeklySummary.archive.oneClient')}
        </span>
        {value !== undefined && (
          <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
            {t('weeklySummary.archive.allClients')}
          </Button>
        )}
      </div>
      <Input
        id={id}
        type="search"
        value={q}
        placeholder={t('weeklySummary.archive.clientSearch')}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
      />
      {open && options.data && (
        <ul role="listbox" aria-label={t('weeklySummary.archive.client')} className="flex flex-col">
          {options.data.items.map((o) => (
            <li key={o.id} role="option" aria-selected={o.id === value}>
              <button
                type="button"
                className="w-full rounded-md px-3 py-2 text-left text-button hover:bg-accent"
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                  setQ('');
                }}
              >
                {label(o)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
