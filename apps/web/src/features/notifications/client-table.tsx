import { memo, useEffect, useId, useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  GroupModes,
  type GroupMode,
  type NotificationGroupRow,
  type NotificationGroupsPage,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { AllGroupsMode } from './all-groups-mode';
import { notificationGroupsQuery, setTicketWatch } from './centre-api';
import { useGroupMode } from './use-modes';

const SEARCH_DELAY_MS = 250;

/**
 * The client table of `/settings/notifications` (UX review X7): every client in one place, the
 * ones the admin manages first, each with its mode (All messages, Mentions and replies, Off) and
 * "New tickets" (watch, X8), both saved at once. Admins also get "All groups:" above it and a
 * search; a client sees their own groups. Rows are native selects and checkboxes (no menu per
 * row), and the list pages by 50.
 */
export function ClientTable({ admin }: { admin: boolean }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setTerm(q.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [q]);
  const query = useInfiniteQuery(notificationGroupsQuery(term));
  const managed = query.data?.pages[0]?.managed ?? [];
  const others = query.data?.pages.flatMap((page) => page.items) ?? [];
  const ids = [...managed, ...others].map((row) => row.id);
  const empty = query.isSuccess && ids.length === 0;
  const prefix = admin ? 'admin' : 'client';

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t(`settings.notifications.clients.title.${prefix}`)}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-button text-muted-foreground">
          {t('settings.notifications.clients.hint')}
        </p>
        {admin && (
          <div className="flex flex-col gap-3 min-[641px]:flex-row min-[641px]:items-center">
            <Input
              type="search"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder={t('settings.notifications.clients.search')}
              aria-label={t('settings.notifications.clients.search')}
              className="min-[641px]:flex-1"
            />
            {ids.length > 0 && <AllGroupsMode groupIds={ids} />}
          </div>
        )}
        {query.isError && (
          <p role="alert" className="text-button text-error-ink">
            {t('errors.generic')}
          </p>
        )}
        {empty && (
          <p className="rounded-lg bg-muted p-4 text-button text-muted-foreground">
            {t(
              term
                ? 'settings.notifications.clients.none'
                : `settings.notifications.clients.empty.${prefix}`,
            )}
          </p>
        )}
        {managed.length > 0 && (
          <Section title={t('settings.notifications.clients.managed')} rows={managed} />
        )}
        {others.length > 0 && (
          <Section
            title={managed.length > 0 ? t('settings.notifications.clients.others') : null}
            rows={others}
          />
        )}
        {query.hasNextPage && (
          <Button
            variant="outline"
            size="lg"
            className="self-start"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t('settings.notifications.clients.more')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function Section({ title, rows }: { title: string | null; rows: NotificationGroupRow[] }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col">
      {title && <h3 className="pb-1 text-micro font-semibold text-muted-foreground">{title}</h3>}
      <div
        aria-hidden="true"
        className="hidden gap-4 border-b border-border pb-2 text-micro font-semibold text-muted-foreground min-[641px]:flex"
      >
        <span className="flex-1">{t('settings.notifications.clients.client')}</span>
        <span className="w-[200px]">{t('settings.notifications.clients.mode')}</span>
        <span className="w-[120px]">{t('settings.notifications.clients.tickets')}</span>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((row) => (
          <ClientRow key={row.id} row={row} />
        ))}
      </ul>
    </section>
  );
}

/** One client: its name, the mode select and the "New tickets" checkbox. */
const ClientRow = memo(function ClientRow({ row }: { row: NotificationGroupRow }) {
  const { t } = useTranslation();
  const id = useId();
  const { mode, setMode, isError } = useGroupMode(row.id);
  const watch = useWatch(row);
  return (
    <li className="flex flex-col gap-2 py-3 min-[641px]:flex-row min-[641px]:items-center min-[641px]:gap-4">
      <span id={`${id}-name`} className="min-w-0 flex-1 truncate text-body font-semibold">
        {row.name}
      </span>
      <Select
        value={mode ?? ''}
        disabled={!mode}
        aria-labelledby={`${id}-name ${id}-mode`}
        onChange={(event) => setMode(event.target.value as GroupMode)}
        containerClassName="w-full min-[641px]:w-[200px] min-[641px]:shrink-0"
        className="py-2"
      >
        {GroupModes.map((value) => (
          <option key={value} value={value}>
            {t(`notifications.mode.${value}`)}
          </option>
        ))}
      </Select>
      <span id={`${id}-mode`} className="sr-only">
        {t('settings.notifications.clients.mode')}
      </span>
      <span className="flex min-[641px]:w-[120px] min-[641px]:shrink-0">
        {row.watching !== null && (
          <label className="inline-flex min-h-8 items-center gap-2 text-tiny font-semibold">
            <input
              type="checkbox"
              className="size-4 accent-foreground"
              checked={watch.checked}
              disabled={watch.pending}
              aria-label={t('settings.notifications.clients.ticketsFor', { name: row.name })}
              onChange={(event) => watch.set(event.target.checked)}
            />
            <span aria-hidden="true" className="min-[641px]:sr-only">
              {t('settings.notifications.clients.tickets')}
            </span>
          </label>
        )}
      </span>
      {(isError || watch.isError) && (
        <p role="alert" className="text-micro text-error-ink">
          {t('errors.generic')}
        </p>
      )}
    </li>
  );
});

/** "New tickets" of one row: saved at once, written into every cached page, rolled back on error. */
function useWatch(row: NotificationGroupRow) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<boolean | null>(null);
  const write = (watching: boolean) =>
    queryClient.setQueriesData<InfiniteData<NotificationGroupsPage>>(
      { queryKey: ['notifications', 'groups'] },
      (old) =>
        old && {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            managed: page.managed.map((r) => (r.id === row.id ? { ...r, watching } : r)),
            items: page.items.map((r) => (r.id === row.id ? { ...r, watching } : r)),
          })),
        },
    );
  const save = useMutation({
    mutationFn: (watching: boolean) => setTicketWatch(row.id, watching),
    onSuccess: (_answer, watching) => {
      write(watching);
      // The Tickets tab's checkbox reads its own query.
      void queryClient.invalidateQueries({ queryKey: ['tickets', 'watch', row.id] });
    },
    onSettled: () => setPicked(null),
  });
  return {
    checked: picked ?? row.watching ?? false,
    pending: save.isPending,
    isError: save.isError,
    set: (watching: boolean) => {
      setPicked(watching);
      save.mutate(watching);
    },
  };
}
