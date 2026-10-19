import { Fragment } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  SnoozeLengths,
  type NotificationCentreState,
  type NotificationItem,
  type NotificationPage,
  type SnoozeLength,
} from '@spolu/shared';
import type { DeferredMenuProps } from '@/components/deferred-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { InfiniteData } from '@tanstack/react-query';
import {
  centreKey,
  centreListQuery,
  centreStateQuery,
  markAllRead,
  markItemRead,
  setSnooze,
} from './centre-api';

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** "Today", "Yesterday", else "18 October" in the reader's language. */
export function dayLabel(
  iso: string,
  language: string,
  t: (key: string) => string,
  now = new Date(),
) {
  const key = dayKey(iso);
  if (key === dayKey(now.toISOString())) return t('notificationCentre.today');
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (key === dayKey(yesterday.toISOString())) return t('notificationCentre.yesterday');
  return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long' }).format(new Date(iso));
}

/** Consecutive items of one day, newest day first (the list is newest first). */
export function groupByDay(items: NotificationItem[]): NotificationItem[][] {
  const days: NotificationItem[][] = [];
  for (const item of items) {
    const last = days.at(-1);
    if (last && dayKey(last[0]!.createdAt) === dayKey(item.createdAt)) last.push(item);
    else days.push([item]);
  }
  return days;
}

/**
 * The notification centre's panel (lazy, opened by the header's bell, `centre-bell.tsx`): what
 * the person was notified about, newest first, by day, each with the push's title and text and
 * its link; an unread one has the yellow "new for you" dot. "Mark all as read" keeps the panel
 * open. Under the list the push snooze ("Stíšiť na 1 h / do zajtra / na týždeň", or the time it
 * runs to and "Zrušiť stíšenie") and the link to `/settings/notifications`.
 */
export function CentrePanel({ trigger }: DeferredMenuProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const list = useInfiniteQuery(centreListQuery);
  const state = useQuery(centreStateQuery);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const snoozedUntil = state.data?.snoozedUntil ?? null;

  const read = useMutation({
    mutationFn: markAllRead,
    onMutate: () => {
      queryClient.setQueryData<NotificationCentreState>(centreStateQuery.queryKey, (old) =>
        old ? { ...old, unread: 0 } : old,
      );
      queryClient.setQueryData<InfiniteData<NotificationPage>>(centreListQuery.queryKey, (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                items: page.items.map((item) => ({ ...item, unread: false })),
              })),
            }
          : old,
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: centreKey }),
  });
  // Opening an item reads it (2026-10-19): at once in the bell, then on the server. Not a
  // mutation of this panel: the navigation closes it, and the write must still finish.
  const openItem = (item: NotificationItem) => {
    if (!item.unread) return;
    queryClient.setQueryData<NotificationCentreState>(centreStateQuery.queryKey, (old) =>
      old ? { ...old, unread: Math.max(0, old.unread - 1) } : old,
    );
    queryClient.setQueryData<InfiniteData<NotificationPage>>(centreListQuery.queryKey, (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((i) => (i.id === item.id ? { ...i, unread: false } : i)),
            })),
          }
        : old,
    );
    void markItemRead(item.id)
      .catch(() => {})
      .finally(() => void queryClient.invalidateQueries({ queryKey: centreKey }));
  };
  const snooze = useMutation({
    mutationFn: setSnooze,
    onSuccess: (next) => queryClient.setQueryData(centreStateQuery.queryKey, next),
  });

  const clock = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' });
  const until = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      weekday: 'short',
      day: 'numeric',
      month: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  const anyUnread = items.some((item) => item.unread) || (state.data?.unread ?? 0) > 0;

  return (
    <DropdownMenu
      defaultOpen
      onOpenChange={(open) => {
        if (!open) return;
        read.reset();
        snooze.reset();
        // Fresh on every open: the list is not live.
        void list.refetch();
      }}
    >
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[min(380px,calc(100vw-24px))]"
        aria-label={t('notificationCentre.title')}
      >
        <div className="flex items-center justify-between gap-2 px-3 pt-1 pb-1">
          <h2 className="text-body font-semibold">{t('notificationCentre.title')}</h2>
          {anyUnread && (
            <DropdownMenuItem
              className="-mr-1 px-2 py-1.5 text-micro font-semibold max-[640px]:min-h-9"
              onSelect={(event) => {
                event.preventDefault();
                read.mutate();
              }}
            >
              {t('notificationCentre.markAll')}
            </DropdownMenuItem>
          )}
        </div>
        {snoozedUntil && (
          <p className="mx-1 rounded-lg bg-muted px-3 py-2 text-micro text-muted-foreground">
            {t('notificationCentre.snooze.until', { time: until(snoozedUntil) })}
          </p>
        )}
        {(list.isError || read.isError || snooze.isError) && (
          <p role="alert" className="px-3 py-2 text-micro text-error-ink">
            {t('errors.generic')}
          </p>
        )}
        {list.isPending && (
          <p className="px-3 py-4 text-button text-muted-foreground">
            {t('notificationCentre.loading')}
          </p>
        )}
        {list.isSuccess && items.length === 0 && (
          <p className="px-3 py-4 text-button text-muted-foreground">
            {t('notificationCentre.empty')}
          </p>
        )}
        {groupByDay(items).map((day) => (
          <Fragment key={dayKey(day[0]!.createdAt)}>
            <DropdownMenuLabel>{dayLabel(day[0]!.createdAt, i18n.language, t)}</DropdownMenuLabel>
            {day.map((item) => (
              <DropdownMenuItem key={item.id} asChild className="items-start">
                <a
                  href={item.url}
                  onAuxClick={() => openItem(item)}
                  onClick={(event) => {
                    openItem(item);
                    // A plain click stays in the app; with a modifier the browser opens a tab.
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
                      return;
                    event.preventDefault();
                    void router.navigate({ href: item.url });
                  }}
                >
                  <span className="mt-1.5 flex w-2.5 shrink-0 justify-center">
                    {item.unread && (
                      <span
                        data-testid="centre-unread"
                        className="size-2.5 rounded-full bg-attention ring-1 ring-attention-foreground/15"
                      />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-semibold text-foreground">{item.title}</span>
                    <span className="line-clamp-2 font-normal text-muted-foreground">
                      {item.body}
                    </span>
                  </span>
                  <time
                    dateTime={item.createdAt}
                    className="shrink-0 pt-0.5 text-micro font-normal text-muted-foreground tabular-nums"
                  >
                    {clock.format(new Date(item.createdAt))}
                  </time>
                  {item.unread && <span className="sr-only">{t('notificationCentre.unread')}</span>}
                </a>
              </DropdownMenuItem>
            ))}
          </Fragment>
        ))}
        {list.hasNextPage && (
          <DropdownMenuItem
            className="justify-center text-muted-foreground"
            disabled={list.isFetchingNextPage}
            onSelect={(event) => {
              event.preventDefault();
              void list.fetchNextPage();
            }}
          >
            {t('notificationCentre.more')}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('notificationCentre.snooze.title')}</DropdownMenuLabel>
        {snoozedUntil ? (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              snooze.mutate(null);
            }}
          >
            {t('notificationCentre.snooze.end')}
          </DropdownMenuItem>
        ) : (
          SnoozeLengths.map((length: SnoozeLength) => (
            <DropdownMenuItem
              key={length}
              onSelect={(event) => {
                event.preventDefault();
                snooze.mutate(length);
              }}
            >
              {t(`notificationCentre.snooze.${length}`)}
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings/notifications">{t('notificationCentre.settings')}</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
