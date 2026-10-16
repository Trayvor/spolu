import { ColumnSkeletons } from '@/components/ui/skeleton';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { GlobalTaskDto } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { useAdminActivityRefetch } from '@/features/admin-home/use-admin-activity';
import { todayInBratislava } from '@/features/tasks/dates';
import { ApiError } from '@/lib/api';
import { fetchColumnPage, globalBoardKey, globalBoardQuery } from './api';
import { BoardFilters } from './board-filters';
import { GlobalColumn } from './global-column';
import { GlobalTaskPanel } from './global-task-panel';
import { useGlobalSearch } from './use-global-search';

const BOARD_KEYS = [globalBoardKey] as const;

/** Extra pages by column id (`todo`, `custom:<key>`…). */
type Extra = Partial<Record<string, { items: GlobalTaskDto[]; next: string | null }>>;

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
  // Only task changes move cards; chat activity and reads leave the board as it is.
  useAdminActivityRefetch(BOARD_KEYS, { kinds: ['task'], chatRead: false });
  const today = todayInBratislava();

  // "Show 50 more" pages, per column, until the first page or the filters change.
  const [extra, setExtra] = useState<Extra>({});
  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  const [moreFailed, setMoreFailed] = useState<string | null>(null);
  const [seen, setSeen] = useState(query.dataUpdatedAt);
  if (seen !== query.dataUpdatedAt) {
    setSeen(query.dataUpdatedAt);
    setExtra({});
    setMoreFailed(null);
  }

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
            return (
              <GlobalColumn
                key={column.id}
                kind={column.kind}
                name={column.name}
                total={column.total}
                items={[...column.items, ...(added?.items ?? [])]}
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
