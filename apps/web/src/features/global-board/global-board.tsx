import { ColumnSkeletons } from '@/components/ui/skeleton';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { GlobalTaskDto } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { useAdminActivityRefetch } from '@/features/admin-home/use-admin-activity';
import { todayInBratislava } from '@/features/tasks/dates';
import { ApiError } from '@/lib/api';
import { fetchColumnPage, globalBoardKey, globalBoardQuery, type GlobalFilters } from './api';
import { BoardFilters } from './board-filters';
import { GlobalColumn } from './global-column';
import { GlobalTaskPanel } from './global-task-panel';
import { FILTER_KEYS, useGlobalSearch } from './use-global-search';
import { withNamespaces } from '@/i18n/namespaces';

// F5: the admin's saved views, a lazy chunk with its texts.
const SavedViewsBar = lazy(
  withNamespaces(['savedViews'], () => import('@/features/saved-views/saved-views-bar')),
);

const BOARD_KEYS = [globalBoardKey] as const;

/** Extra pages by column id (`todo`, `custom:<key>`…); `pages` is how many were loaded. */
type Extra = Partial<
  Record<string, { items: GlobalTaskDto[]; next: string | null; pages: number }>
>;

/**
 * Loads `pages` pages of one column after `after` again, one after another, for a refetched
 * first page: the same depth the person had opened, with today's cards.
 */
async function reloadPages(
  filters: GlobalFilters,
  id: string,
  after: string | null,
  pages: number,
): Promise<NonNullable<Extra[string]>> {
  const items: GlobalTaskDto[] = [];
  let next = after;
  let loaded = 0;
  while (next !== null && loaded < pages) {
    const page = await fetchColumnPage(filters, id, next);
    const column = page.columns.find((c) => c.id === id);
    items.push(...(column?.items ?? []));
    next = column?.next ?? null;
    loaded += 1;
  }
  return { items, next, pages: loaded };
}

/**
 * The admins' task board across clients (`/tasks`): the filter row, then the columns the server
 * sends: To do, one per custom bucket name of the chosen clients, Other steps (only for the names
 * beyond the cap), the two reviews and Completed (only when shown), 50 cards each with
 * "Show 50 more". A card opens the task panel over
 * this board (`?task=<id>`); closing it returns to the same filtered board. Live through
 * `admin:activity`, debounced 2 s.
 */
export function GlobalBoardPage() {
  const { t } = useTranslation();
  const board = useGlobalSearch();
  const { filters, search } = board;
  const query = useQuery(globalBoardQuery(filters));
  // Task changes move cards; chat activity and opening a task change their unseen marks
  // (2026-10-17). Reads leave the board as it is.
  useAdminActivityRefetch(BOARD_KEYS, { chatRead: false });
  const today = todayInBratislava();

  // "Show 50 more" pages, per column, until the filters change (Phase 27 W5). A refetch of the
  // first page (a task changed, a refocus) keeps them and reloads them to the same depth.
  const [extra, setExtra] = useState<Extra>({});
  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  const [moreFailed, setMoreFailed] = useState<string | null>(null);
  const filterKey = JSON.stringify(filters);
  const [extraFor, setExtraFor] = useState(filterKey);
  if (extraFor !== filterKey) {
    setExtraFor(filterKey);
    setExtra({});
    setMoreFailed(null);
  }
  // The latest pages and filters for the reload below (set first: effects run in order).
  const extraRef = useRef(extra);
  const keyRef = useRef(filterKey);
  useEffect(() => {
    extraRef.current = extra;
    keyRef.current = filterKey;
  });
  const seen = useRef(query.dataUpdatedAt);
  useEffect(() => {
    if (seen.current === query.dataUpdatedAt) return;
    seen.current = query.dataUpdatedAt;
    const columns = query.data?.columns ?? [];
    const open = Object.entries(extraRef.current).filter(([, e]) => e && e.pages > 0);
    if (open.length === 0) return;
    const forKey = filterKey;
    const at = query.dataUpdatedAt;
    void Promise.all(
      open.map(async ([id, e]) => {
        const base = columns.find((c) => c.id === id);
        return [
          id,
          base ? await reloadPages(filters, id, base.next, e!.pages) : undefined,
        ] as const;
      }),
    )
      .then((reloaded) => {
        // Dropped when the filters changed or a newer refetch started its own reload.
        if (keyRef.current !== forKey || seen.current !== at) return;
        setExtra((all) => ({ ...all, ...Object.fromEntries(reloaded) }));
      })
      // A failed reload keeps the pages as they were; the next refetch tries again.
      .catch(() => undefined);
  }, [query.dataUpdatedAt, query.data, filters, filterKey]);

  // A filter the server refuses (an old bookmark): back to the defaults.
  const invalid = query.error instanceof ApiError && query.error.status === 400;
  const { reset } = board;
  useEffect(() => {
    if (invalid) reset();
  }, [invalid, reset]);

  async function more(id: string, after: string) {
    setLoadingMore(id);
    setMoreFailed(null);
    try {
      const page = await fetchColumnPage(filters, id, after);
      const column = page.columns.find((c) => c.id === id);
      setExtra((all) => ({
        ...all,
        [id]: {
          items: [...(all[id]?.items ?? []), ...(column?.items ?? [])],
          next: column?.next ?? null,
          pages: (all[id]?.pages ?? 0) + 1,
        },
      }));
    } catch {
      setMoreFailed(id);
    } finally {
      setLoadingMore(null);
    }
  }

  const data = query.data;
  const empty = data !== undefined && data.columns.every((c) => c.total === 0);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <h1 className="text-medium leading-tight font-semibold">{t('adminHome.board.title')}</h1>
      <BoardFilters board={board} people={data?.people ?? []} />
      <Suspense fallback={null}>
        <SavedViewsBar page="board" keys={FILTER_KEYS} />
      </Suspense>
      {query.isError && !invalid ? (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-button text-muted-foreground">{t('adminHome.shell.loadError')}</p>
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            {t('adminHome.shell.retry')}
          </Button>
        </div>
      ) : empty ? (
        <div className="flex flex-col items-start gap-2 py-6">
          <p className="text-button text-muted-foreground">
            {board.changed > 0 ? t('adminHome.board.emptyFiltered') : t('adminHome.board.empty')}
          </p>
          {board.changed > 0 && (
            <Button variant="secondary" size="sm" onClick={board.clear}>
              {t('adminHome.board.clear')}
            </Button>
          )}
        </div>
      ) : data ? (
        // `relative`: the cards' sr-only texts stay inside the scroller (see the group board).
        <div className="relative flex snap-x snap-mandatory items-start gap-3 overflow-x-auto pb-3 min-[641px]:snap-none">
          {data.columns.map((column) => {
            const added = extra[column.id];
            const next = added ? added.next : column.next;
            // A card that moved up into the first page meanwhile is shown once.
            const shown = new Set(column.items.map((item) => item.id));
            return (
              <GlobalColumn
                key={column.id}
                kind={column.kind}
                name={column.name}
                total={column.total}
                items={[
                  ...column.items,
                  ...(added?.items ?? []).filter((item) => !shown.has(item.id)),
                ]}
                hasMore={next !== null}
                loadingMore={loadingMore === column.id}
                moreFailed={moreFailed === column.id}
                onMore={() => next && void more(column.id, next)}
                search={search}
                today={today}
              />
            );
          })}
        </div>
      ) : (
        <div role="status">
          <span className="sr-only">{t('adminHome.board.title')}</span>
          <ColumnSkeletons />
        </div>
      )}
      {search.task && <GlobalTaskPanel taskId={search.task} />}
    </div>
  );
}
