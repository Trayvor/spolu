import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import type { GlobalBoardSearch } from '@/router';
import { useRememberedFilters } from '@/lib/use-remembered-filters';
import { useUpdateSearch } from '@/lib/use-update-search';
import type { GlobalFilters } from './api';

/** The filter keys the board writes; "Clear filters" removes them all. */
const FILTER_KEYS = [
  'clients',
  'assignee',
  'urgent',
  'mine',
  'due',
  'q',
  'completed',
  'project',
] as const;
/** The ones remembered for the next visit: all but the free text search. */
const REMEMBERED_KEYS = FILTER_KEYS.filter((key) => key !== 'q');

const SEARCH_DEBOUNCE_MS = 300;

/**
 * The global board's filters, all in the URL (`/tasks?clients&assignee&urgent&mine&due&q&completed`)
 * plus the open task (`task`). A visit without filters restores the person's last ones (all but
 * the search text, `useRememberedFilters`); `null` clients is the default scope (the managed
 * clients, or all).
 */
export function useGlobalSearch() {
  const raw = useSearch({ strict: false }) as GlobalBoardSearch;
  const search = useRememberedFilters('globalBoard', REMEMBERED_KEYS, raw);
  const update = useUpdateSearch();
  const clientsParam = search.clients;
  // Projects are per client: the Project filter applies only with exactly one client (decision 19).
  const oneClient =
    clientsParam !== undefined && clientsParam !== 'all' && !clientsParam.includes(',')
      ? clientsParam
      : null;
  const project = oneClient !== null ? search.project : undefined;

  const filters = useMemo<GlobalFilters>(
    () => ({
      clients: clientsParam,
      assignee: search.assignee,
      urgent: search.urgent === 1 || undefined,
      mine: search.mine === 1 || undefined,
      due: search.due,
      q: search.q && search.q.trim().length >= 2 ? search.q.trim() : undefined,
      completed: search.completed === 1 || undefined,
      project,
    }),
    [
      clientsParam,
      search.assignee,
      search.urgent,
      search.mine,
      search.due,
      search.q,
      search.completed,
      project,
    ],
  );
  const clients = clientsParam === undefined ? null : clientsParam.split(',').filter(Boolean);

  const set = (change: (next: Record<string, unknown>) => void) =>
    update(change, { replace: true });

  const setClients = (next: string[] | null) => {
    const value = next === null ? null : next.join(',');
    set((s) => {
      if (value === null) delete s.clients;
      else s.clients = value;
      // Another client, or more than one: the project of the old one no longer applies.
      if (value !== oneClient) delete s.project;
    });
  };

  // The search field applies after 300 ms; a `q` changed in the URL (Back, Clear) is copied in.
  const [text, setText] = useState(search.q ?? '');
  const [seenQ, setSeenQ] = useState(search.q);
  if (search.q !== seenQ) {
    setSeenQ(search.q);
    setText(search.q ?? '');
  }
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const changeText = (next: string) => {
    setText(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () =>
        set((s) => {
          const q = next.trim();
          if (q) s.q = q;
          else delete s.q;
        }),
      SEARCH_DEBOUNCE_MS,
    );
  };

  /** How many filters differ from the defaults (for "Filters (n)" and "Clear filters"). */
  const changed = FILTER_KEYS.filter((key) =>
    key === 'clients'
      ? clientsParam !== undefined
      : key === 'project'
        ? project !== undefined
        : search[key] !== undefined,
  ).length;

  const clear = () => {
    clearTimeout(timer.current);
    set((s) => {
      for (const key of FILTER_KEYS) delete s[key];
    });
  };

  /** Back to the defaults after the server refused a filter (400 `invalid_filter`). */
  const reset = () => {
    update(
      (s) => {
        for (const key of [...FILTER_KEYS, 'column', 'after']) delete s[key];
      },
      { replace: true },
    );
  };

  return {
    search,
    filters,
    clients,
    /** The one chosen client, or null (the Project pill shows only then). */
    oneClient,
    set,
    setClients,
    text,
    changeText,
    changed,
    clear,
    reset,
  };
}
