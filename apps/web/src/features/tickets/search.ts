import type { TicketFilter } from './api';

/**
 * The ticket lists' filters in the URL. Spelled out without the shared schemas: the router (the
 * entry chunk) imports this file. `status` is absent for Open; `clients` is `all` or a comma list
 * of client ids (global view); `none=1` is "Without client"; `assignee` is the riešiteľ filter
 * (`me` or `none`, absent for anyone).
 */
export type TicketsSearch = {
  status?: 'resolved' | 'all';
  area?: string;
  following?: 1;
  assignee?: 'me' | 'none';
  clients?: string;
  none?: 1;
};

const text = (v: unknown) =>
  typeof v === 'number' ? String(v) : typeof v === 'string' && v.trim() ? v.trim() : undefined;
const flag = (v: unknown) => (v === 1 || v === '1' || v === true ? (1 as const) : undefined);

/** Every key is set (an invalid one to undefined), so a raw value never slips through. */
export function validateTicketsSearch(search: Record<string, unknown>): TicketsSearch {
  return {
    status: search.status === 'resolved' || search.status === 'all' ? search.status : undefined,
    area: text(search.area)?.slice(0, 200),
    following: flag(search.following),
    assignee: search.assignee === 'me' || search.assignee === 'none' ? search.assignee : undefined,
    clients: text(search.clients),
    none: flag(search.none),
  };
}

export function filterFromSearch(search: TicketsSearch): TicketFilter {
  return {
    status: search.status ?? 'open',
    area: search.area,
    following: search.following === 1 || undefined,
    assignee: search.assignee,
    clients:
      search.clients === undefined
        ? null
        : search.clients === 'all'
          ? 'all'
          : search.clients.split(',').filter(Boolean),
    noClient: search.none === 1 || undefined,
  };
}

/** Writes a filter into a copy of the search params (other params are kept). */
export function writeFilter(next: Record<string, unknown>, filter: TicketFilter): void {
  const set = (key: string, value: unknown) => {
    if (value === undefined) delete next[key];
    else next[key] = value;
  };
  set('status', filter.status === 'open' ? undefined : filter.status);
  set('area', filter.area || undefined);
  set('following', filter.following ? 1 : undefined);
  set('assignee', filter.assignee);
  const { clients } = filter;
  set('clients', clients == null ? undefined : clients === 'all' ? 'all' : clients.join(','));
  set('none', filter.noClient ? 1 : undefined);
}
