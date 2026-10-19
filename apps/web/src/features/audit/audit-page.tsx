import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { AuditEntryDto } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { ListSkeleton } from '@/components/ui/skeleton';
import { adminsQuery } from '@/features/admins/api';
import { useSession } from '@/features/auth/use-session';
import { groupsQuery } from '@/features/groups/api';
import { useMediaQuery } from '@/lib/use-media-query';
import { useRememberedFilters } from '@/lib/use-remembered-filters';
import { useUpdateSearch } from '@/lib/use-update-search';
import { activeFilterCount, AuditFilters, ClearFilters, type FilterChange } from './audit-filters';
import { AuditRow, type AuditPick } from './audit-row';
import { auditFilters, auditQuery } from './api';
import { dayHeading, dayKey } from './format';
import { AUDIT_REMEMBERED_KEYS, validateAuditSearch } from './search';

const ALL_KEYS = ['entityType', 'entityId', 'group', 'actor', 'from', 'to', 'label'] as const;

/** Rows grouped by their Bratislava day, newest first (the server's order). */
function byDay(items: AuditEntryDto[]): { key: string; first: string; items: AuditEntryDto[] }[] {
  const days: { key: string; first: string; items: AuditEntryDto[] }[] = [];
  for (const item of items) {
    const key = dayKey(item.createdAt);
    const last = days[days.length - 1];
    if (last?.key === key) last.items.push(item);
    else days.push({ key, first: item.createdAt, items: [item] });
  }
  return days;
}

/**
 * „História zmien“ (`/audit`, spec §4.2): who changed what and when, admins only (the server
 * answers 403 to anyone else and leaves finance rows out for admins without the right).
 * Filters in the URL, remembered for the next visit (the one record never); 50 rows a page,
 * "Načítať staršie" appends. No live updates: „Obnoviť“ fetches the first page again.
 */
export function AuditPage() {
  const { t, i18n } = useTranslation();
  const me = useSession();
  const search = useRememberedFilters(
    'audit',
    AUDIT_REMEMBERED_KEYS,
    validateAuditSearch(useSearch({ strict: false }) as Record<string, unknown>),
  );
  const update = useUpdateSearch();
  const phone = useMediaQuery('(max-width: 640px)');
  const [sheet, setSheet] = useState(false);
  const groups = useQuery(groupsQuery).data ?? [];
  const admins = useQuery(adminsQuery).data ?? [];
  const filters = auditFilters(search);
  const query = useInfiniteQuery(auditQuery(filters));
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Object.keys(filters).length > 0;
  const finance = me?.finance === true;

  const change: FilterChange = (next) =>
    update(
      (s) => {
        for (const [key, value] of Object.entries(next)) {
          if (value === undefined) delete s[key];
          else s[key] = value;
        }
      },
      { replace: true },
    );
  const clear = () => change(Object.fromEntries(ALL_KEYS.map((k) => [k, undefined])));
  const pick = (p: AuditPick) =>
    p.kind === 'actor'
      ? change({ actor: p.actor, label: p.label })
      : change({ entityType: p.entityType, entityId: p.entityId, label: p.label });

  const filterProps = { search, onChange: change, finance, groups, admins };
  const count = activeFilterCount(search);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 min-[641px]:flex-row min-[641px]:items-start min-[641px]:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-medium leading-tight font-semibold">{t('audit.title')}</h1>
          <p className="text-button text-muted-foreground">{t('audit.intro')}</p>
        </div>
        <Button
          variant="outline"
          className="w-full min-[641px]:w-auto"
          onClick={() => void query.refetch()}
        >
          {t('audit.refresh')}
        </Button>
      </div>

      <div role="group" aria-label={t('audit.filters.label')} className="flex flex-col gap-3">
        {phone ? (
          <Button variant="secondary" className="self-start" onClick={() => setSheet(true)}>
            {t('audit.filters.phone', { count })}
          </Button>
        ) : (
          <AuditFilters {...filterProps} />
        )}
        <div className="flex flex-wrap items-center gap-2 empty:hidden">
          {search.entityType && search.entityId && (
            <Chip
              label={t('audit.filters.record', {
                label: search.label ?? t(`audit.types.${search.entityType}`),
              })}
              onRemove={() => change({ entityId: undefined, label: undefined })}
            />
          )}
          {(filtered || search.entityId) && <ClearFilters onClear={clear} />}
        </div>
      </div>

      {sheet && (
        <SheetDialog compact onEscape={() => setSheet(false)}>
          <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
            <SheetDialogTitle className="text-button font-semibold">
              {t('audit.filters.label')}
            </SheetDialogTitle>
            <Button size="sm" onClick={() => setSheet(false)}>
              {t('audit.filters.done')}
            </Button>
          </div>
          <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
            <AuditFilters {...filterProps} stacked />
            {count > 0 && <ClearFilters onClear={clear} />}
          </div>
        </SheetDialog>
      )}

      {query.isPending && (
        <div className="flex flex-col gap-3">
          <p className="sr-only" role="status">
            {t('audit.loading')}
          </p>
          <ListSkeleton rows={4} />
        </div>
      )}
      {query.isError && items.length === 0 && (
        <div className="flex flex-col items-start gap-3" role="alert">
          <p className="text-body">{t('audit.error')}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('audit.retry')}
          </Button>
        </div>
      )}
      {query.isSuccess && items.length === 0 && (
        <p className="text-body text-muted-foreground">
          {filtered ? t('audit.emptyFiltered') : t('audit.empty')}
        </p>
      )}
      {items.length > 0 && (
        <div className="flex flex-col gap-5">
          {byDay(items).map((day) => (
            <section
              key={day.key}
              aria-labelledby={`audit-day-${day.key}`}
              className="flex flex-col gap-2"
            >
              <h2 id={`audit-day-${day.key}`} className="text-button font-semibold">
                {dayHeading(day.first, i18n.language)}
              </h2>
              <Card className="gap-0 py-1">
                <ul role="list" className="divide-y divide-border">
                  {day.items.map((entry) => (
                    <AuditRow key={entry.id} entry={entry} onPick={pick} />
                  ))}
                </ul>
              </Card>
            </section>
          ))}
          {query.hasNextPage && (
            <Button
              variant="secondary"
              className="self-center"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? t('audit.loading') : t('audit.loadOlder')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-secondary py-1 pr-1 pl-3 text-tiny font-semibold">
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('audit.filters.removeChip', { label })}
        className="inline-flex size-6 items-center justify-center rounded-full hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="m3 3 6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
    </span>
  );
}
