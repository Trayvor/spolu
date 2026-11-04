import { lazy, Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useRouter, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TicketDto } from '@spolu/shared';
import { ClientFilter, type ClientOption, toClientOptions } from '@/components/client-filter';
import { Button, buttonVariants } from '@/components/ui/button';
import { clientGroups, isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { groupsQuery } from '@/features/groups/api';
import { isLayerOpen } from '@/lib/use-back-closes';
import { knowledgeScopeQuery } from '@/features/knowledge/api';
import { useRememberedFilters } from '@/lib/use-remembered-filters';
import { useUpdateSearch } from '@/lib/use-update-search';
import { cn } from '@/lib/utils';
import { withNamespaces } from '@/i18n/namespaces';
import type { TicketFilter } from './api';
import { CheckIcon } from './icons';
import { NewTicketDialog } from './new-ticket-dialog';
import { filterFromSearch, writeFilter, type TicketsSearch } from './search';
import { TicketList } from './ticket-list';

// F5: the admins' saved views, a lazy chunk with its texts.
const SavedViewsBar = lazy(
  withNamespaces(['savedViews'], () => import('@/features/saved-views/saved-views-bar')),
);

/** The ticket filters remembered for the next visit (`useRememberedFilters`), and a view's. */
const REMEMBERED_KEYS = [
  'status',
  'area',
  'assignee',
  'clients',
  'none',
  'project',
  'event',
] as const;

/**
 * The filter in the URL: every change is one history entry, as on the knowledge list. A visit
 * without filters gets the person's last ones for this list (`list`: per group on a tab).
 */
function useUrlFilter(list: string): [TicketFilter, (next: TicketFilter) => void] {
  const search = useRememberedFilters(
    list,
    REMEMBERED_KEYS,
    useSearch({ strict: false }) as TicketsSearch,
  );
  const update = useUpdateSearch();
  const filter = filterFromSearch(search);
  return [filter, (next) => update((s) => writeFilter(s, next), { replace: false })];
}

/**
 * After a ticket is created, its page, in place of the closing form's own history entry (so Back
 * from the ticket goes to the list, not to the list again).
 */
function useOpenTicket() {
  const navigate = useNavigate();
  const router = useRouter();
  return (ticket: TicketDto) =>
    void navigate({
      to: '/tickets/$ticketId',
      params: { ticketId: ticket.id },
      replace: isLayerOpen(router.state.location.state),
    });
}

/**
 * `/tickets`: for admins the global view of every client's tickets (Phase 21) with the client
 * filter of the global board and "Without client"; for everyone else **My tickets**, the tickets
 * they reported across their clients (the only screen of a requester).
 */
export function TicketsPage() {
  const admin = isAdmin(useSession());
  return admin ? <GlobalTickets /> : <MyTickets />;
}

function MyTickets() {
  const { t } = useTranslation();
  const [filter, setFilter] = useUrlFilter('tickets');
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-medium leading-tight font-semibold">{t('tickets.mine.title')}</h1>
      <TicketList
        source={{ kind: 'mine' }}
        filter={filter}
        onFilterChange={setFilter}
        empty={
          <p className="py-8 text-center text-button text-muted-foreground">
            {t('tickets.mine.empty')}
          </p>
        }
      />
    </div>
  );
}

function GlobalTickets() {
  const { t } = useTranslation();
  const [filter, setFilter] = useUrlFilter('tickets');
  const [creating, setCreating] = useState(false);
  const openTicket = useOpenTicket();
  const groups = useQuery(groupsQuery).data;
  const scope = useQuery(knowledgeScopeQuery).data;
  const options = useMemo<ClientOption[]>(() => toClientOptions(groups ?? [], false), [groups]);
  const loaded = groups !== undefined && scope !== undefined;
  const allIds = options.map((g) => g.id);
  const clients = filter.clients === 'all' ? allIds : (filter.clients ?? null);
  // Phase 33 part P2: projects are per client, so the Project pill needs exactly one client.
  const oneClient =
    !filter.noClient && Array.isArray(filter.clients) && filter.clients.length === 1
      ? filter.clients[0]!
      : null;

  const extras = (
    <>
      <ClientFilter
        groups={options}
        managedIds={scope?.managedGroupIds ?? null}
        value={filter.noClient ? null : clients}
        onChange={(next) =>
          setFilter({
            ...filter,
            noClient: undefined,
            // A project of one client means nothing for another choice.
            ...(next?.length === 1 && next[0] === oneClient ? {} : { project: undefined }),
            event: undefined,
            clients:
              next !== null && allIds.length > 0 && allIds.every((id) => next.includes(id))
                ? 'all'
                : next,
          })
        }
        disabled={!loaded || !!filter.noClient}
      />
      <button
        type="button"
        aria-pressed={!!filter.noClient}
        onClick={() =>
          setFilter({
            ...filter,
            noClient: !filter.noClient || undefined,
            project: undefined,
            event: undefined,
          })
        }
        className={cn(
          "relative inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-tiny font-semibold before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-['']",
          filter.noClient
            ? 'bg-primary pl-3 text-primary-foreground'
            : 'bg-secondary text-secondary-foreground hover:bg-surface-3',
        )}
      >
        {filter.noClient && <CheckIcon />}
        {t('tickets.filters.noClient')}
      </button>
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-between">
        <h1 className="text-medium leading-tight font-semibold">{t('tickets.global.title')}</h1>
        <div className="flex flex-wrap gap-2">
          {/* 2026-10-19: the ratings view (admins; this view is theirs only). */}
          <Link to="/tickets/ratings" className={buttonVariants({ variant: 'secondary' })}>
            {t('tickets.global.ratingsLink')}
          </Link>
          <Button onClick={() => setCreating(true)}>{t('tickets.new')}</Button>
        </div>
      </div>
      <TicketList
        source={{ kind: 'global' }}
        filter={filter}
        onFilterChange={setFilter}
        filterExtras={extras}
        belowFilters={
          <Suspense fallback={null}>
            <SavedViewsBar page="tickets" keys={REMEMBERED_KEYS} />
          </Suspense>
        }
        disabled={!loaded}
        projectScope={oneClient ? { groupId: oneClient, events: false } : undefined}
        egrantFilter
      />
      {creating && (
        <NewTicketDialog admin onClose={() => setCreating(false)} onCreated={openTicket} />
      )}
    </div>
  );
}

/** The group's Tickets tab: every ticket of the client (a requester sees only their own). */
export function TicketsTab() {
  const { t } = useTranslation();
  const { groupId } = useParams({ strict: false });
  const me = useSession();
  const [filter, setFilter] = useUrlFilter(`tickets:${groupId ?? ''}`);
  const [creating, setCreating] = useState(false);
  const openTicket = useOpenTicket();
  if (!groupId || !me) return null;
  const admin = isAdmin(me);
  // Admins and the group's clients create tickets; a requester does not.
  const canCreate = admin || clientGroups(me).some((g) => g.id === groupId);
  return (
    <div className="flex flex-col gap-4">
      {canCreate && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
          <Button onClick={() => setCreating(true)}>{t('tickets.new')}</Button>
        </div>
      )}
      <TicketList
        source={{ kind: 'group', groupId }}
        filter={filter}
        onFilterChange={setFilter}
        // A requester cannot read the client's projects: no project pills for them.
        projectScope={canCreate ? { groupId, events: true } : undefined}
        egrantFilter={canCreate}
      />
      {creating && (
        <NewTicketDialog
          admin={admin}
          groupId={groupId}
          onClose={() => setCreating(false)}
          onCreated={openTicket}
        />
      )}
    </div>
  );
}
