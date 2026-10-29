import { memo, useId, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { SidebarClient } from '@spolu/shared';
import { UnreadPill } from '@/features/chat/unread';
import { GroupLogo } from '@/features/groups/group-logo';
import { cn } from '@/lib/utils';

/** Lower case without diacritics, so "luky" finds "Obec Lúky". */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * One client. Memoized: react-query keeps unchanged clients the same objects across refetches,
 * so a route change or a sidebar refetch redraws only the rows that changed. `t` comes from the
 * list (one i18n subscription, not one per row).
 */
const Row = memo(function Row({
  client,
  current,
  rowHeight,
  collapsed,
  t,
}: {
  client: SidebarClient;
  current: boolean;
  rowHeight: 40 | 48;
  collapsed: boolean;
  t: TFunction;
}) {
  // 2026-10-17: one black badge for what is new here, its parts in the screen-reader label.
  const badge = client.unread + client.unseenTasks + client.unseenTickets;
  const badgeLabel = [
    client.unread > 0 && t('adminHome.sidebar.messages', { count: client.unread }),
    client.unseenTasks > 0 && t('adminHome.sidebar.tasks', { count: client.unseenTasks }),
    client.unseenTickets > 0 && t('adminHome.sidebar.tickets', { count: client.unseenTickets }),
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <li>
      <Link
        to="/groups/$groupId/overview"
        params={{ groupId: client.groupId }}
        aria-current={current ? 'page' : undefined}
        title={collapsed ? client.name : undefined}
        className={cn(
          'flex items-center gap-2 rounded-lg px-2 text-button hover:bg-accent hover:text-foreground',
          rowHeight === 40 ? 'h-10' : 'h-12',
          collapsed && 'justify-center px-0',
          current ? 'bg-secondary font-semibold' : 'font-medium',
        )}
      >
        <span className="relative shrink-0">
          <GroupLogo
            groupId={client.groupId}
            name={client.name}
            hasLogo={client.hasLogo}
            version={client.updatedAt}
            size={24}
            className="rounded-md"
            admin={client.section === 'internal'}
          />
          {collapsed && badge > 0 && (
            <span
              aria-hidden="true"
              data-testid="rail-dot"
              className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-card"
            />
          )}
        </span>
        {collapsed ? (
          <span className="sr-only">{[client.name, badgeLabel].filter(Boolean).join(', ')}</span>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate">{client.name}</span>
            <UnreadPill count={badge} label={badgeLabel} />
          </>
        )}
      </Link>
    </li>
  );
});

/**
 * The admin's client list: a find field, then "Internal" (the admin group "eGrant tím", Phase 34),
 * "Managed by you" and "Other clients" in the
 * server's order (those with a badge, then the rest, by name). The badge adds the unread group
 * chat messages and the tasks and tickets with an unseen change (2026-10-17). The sidebar uses 40 px rows,
 * the phone home 48 px; collapsed (the sidebar's rail) shows logos with a dot only.
 */
export function ClientSidebarList({
  clients,
  currentGroupId,
  rowHeight,
  collapsed = false,
}: {
  clients: SidebarClient[];
  currentGroupId?: string;
  rowHeight: 40 | 48;
  collapsed?: boolean;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const findId = useId();
  const shown = useMemo(() => {
    const needle = fold(query.trim());
    return needle ? clients.filter((c) => fold(c.name).includes(needle)) : clients;
  }, [clients, query]);
  const { internal, managed, others } = useMemo(
    () => ({
      internal: shown.filter((c) => c.section === 'internal'),
      managed: shown.filter((c) => c.section !== 'internal' && c.managed),
      others: shown.filter((c) => c.section !== 'internal' && !c.managed),
    }),
    [shown],
  );
  const anyManaged = useMemo(
    () => clients.some((c) => c.section !== 'internal' && c.managed),
    [clients],
  );

  const list = (items: SidebarClient[]) => (
    <ul role="list" className="flex flex-col gap-0.5">
      {items.map((client) => (
        <Row
          key={client.groupId}
          client={client}
          current={client.groupId === currentGroupId}
          rowHeight={rowHeight}
          collapsed={collapsed}
          t={t}
        />
      ))}
    </ul>
  );
  const heading = (text: string) => (
    <h3 className="px-2 pb-1 text-micro font-medium text-muted-foreground">{text}</h3>
  );

  if (collapsed) {
    return (
      <nav aria-label={t('adminHome.sidebar.title')} className="flex flex-col gap-2">
        {list(internal)}
        {internal.length > 0 && managed.length + others.length > 0 && (
          <hr className="mx-2 border-border" />
        )}
        {list(managed)}
        {managed.length > 0 && others.length > 0 && <hr className="mx-2 border-border" />}
        {list(others)}
      </nav>
    );
  }

  return (
    <nav aria-label={t('adminHome.sidebar.title')} className="flex flex-col gap-3">
      <label htmlFor={findId} className="sr-only">
        {t('adminHome.sidebar.find')}
      </label>
      <input
        id={findId}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('adminHome.sidebar.find')}
        className="h-9 w-full rounded-md border-2 border-input bg-card px-3 text-tiny font-medium touch:h-11 placeholder:text-muted-foreground focus:border-foreground"
      />
      {shown.length === 0 && (
        <p className="px-2 text-micro text-muted-foreground">{t('adminHome.sidebar.noMatch')}</p>
      )}
      {internal.length > 0 && (
        <section>
          {heading(t('adminHome.sidebar.internal'))}
          {list(internal)}
        </section>
      )}
      {internal.length > 0 && managed.length + others.length > 0 && (
        <hr className="mx-2 border-border" />
      )}
      {anyManaged ? (
        <>
          {managed.length > 0 && (
            <section>
              {heading(t('adminHome.sidebar.managed'))}
              {list(managed)}
            </section>
          )}
          {managed.length > 0 && others.length > 0 && <hr className="mx-2 border-border" />}
          {others.length > 0 && (
            <section>
              {heading(t('adminHome.sidebar.others'))}
              {list(others)}
            </section>
          )}
        </>
      ) : (
        others.length > 0 && list(others)
      )}
    </nav>
  );
}

/** The loading rows: static grey bars (no shimmer). */
export function SidebarRowsPlaceholder({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2 px-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-10 items-center gap-2">
          <span className="size-6 animate-skeleton rounded-md bg-secondary" />
          <span className="h-3 flex-1 animate-skeleton rounded-full bg-secondary" />
        </div>
      ))}
    </div>
  );
}
