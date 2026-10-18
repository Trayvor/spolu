import { useMemo } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useSession } from '@/features/auth/use-session';
import {
  readRemembered,
  rememberedFiltersKey,
  useRememberedFilters,
  writeRemembered,
} from '@/lib/use-remembered-filters';
import { useUpdateSearch, type SearchRecord } from '@/lib/use-update-search';
import { currentMonth, PAGE_PERIODS, rangeOf, type Period } from './period';
import type { PeriodState } from './period-select';
import { FINANCE_FILTER_KEYS, type FinanceSearch } from './search';
import type { FinanceClients } from './system/client-filter';

/** The remembered filters' list (`spolu.filters.<userId>.finance.page`). */
const LIST = 'finance.page';
/** Where the page kept its filters before they moved into the URL (2026-10-18). */
const LEGACY = {
  clients: 'finance.clients',
  period: 'finance.page.period',
  custom: 'finance.page.period.custom',
} as const;

/**
 * Moves the filters the page remembered before they were URL params into the one entry
 * `useRememberedFilters` reads, once: a returning person's choice survives the change.
 */
export function migrateLegacyFinanceFilters(userId: string): void {
  const key = (list: string) => rememberedFiltersKey(userId, list);
  if (readRemembered(key(LIST)) !== null) return;
  const clients = readRemembered(key(LEGACY.clients));
  const period = readRemembered(key(LEGACY.period));
  const custom = readRemembered(key(LEGACY.custom));
  if (clients === null && period === null && custom === null) return;
  const next: SearchRecord = {};
  if (typeof clients?.clients === 'string' && clients.clients) next.clients = clients.clients;
  else if (clients?.internal === '0') next.internal = 0;
  if (typeof custom?.from === 'string' && typeof custom.to === 'string') {
    Object.assign(next, { period: 'custom', from: custom.from, to: custom.to });
  } else if (typeof period?.value === 'string' && period.value !== PAGE_PERIODS[0]) {
    next.period = period.value;
  }
  writeRemembered(key(LIST), Object.keys(next).length > 0 ? next : null);
  for (const list of Object.values(LEGACY)) writeRemembered(key(list), null);
}

/**
 * `/finance`'s client choice and page period, both in the URL (`search.ts`): a link or a saved
 * view opens the same filters. A visit without any of them gets the person's last ones
 * (`useRememberedFilters`), written into the URL. Each change replaces the history entry, as on
 * the global board.
 */
export function useFinancePageFilters(): {
  clients: FinanceClients;
  setClients: (next: FinanceClients) => void;
  period: PeriodState;
} {
  const userId = useSession()?.id ?? null;
  // Before `useRememberedFilters` reads the entry.
  useMemo(() => userId !== null && migrateLegacyFinanceFilters(userId), [userId]);
  const raw = useSearch({ strict: false }) as FinanceSearch;
  const search = useRememberedFilters(LIST, FINANCE_FILTER_KEYS, raw);
  const update = useUpdateSearch();
  const set = (change: (next: SearchRecord) => void) => update(change, { replace: true });

  const clients = useMemo<FinanceClients>(
    () => ({
      clients: search.clients?.split(',').filter(Boolean) ?? [],
      internal: search.internal !== 0,
    }),
    [search.clients, search.internal],
  );
  const setClients = (next: FinanceClients) =>
    set((s) => {
      delete s.clients;
      delete s.internal;
      if (next.clients.length > 0) s.clients = next.clients.join(',');
      else if (!next.internal) s.internal = 0;
    });

  const periods = PAGE_PERIODS;
  const chosen: Period = search.period ?? periods[0];
  const month = currentMonth();
  const custom =
    chosen === 'custom' ? { from: search.from ?? month, to: search.to ?? month } : null;
  const setCustom = (next: { from: string; to: string } | null) =>
    set((s) => {
      delete s.from;
      delete s.to;
      if (next === null) delete s.period;
      else Object.assign(s, { period: 'custom', from: next.from, to: next.to });
    });
  const choose = (next: Period) =>
    set((s) => {
      delete s.from;
      delete s.to;
      if (next === periods[0]) delete s.period;
      else s.period = next;
      if (next === 'custom') Object.assign(s, { from: month, to: month });
    });
  const period: PeriodState = {
    period: chosen,
    range: rangeOf(chosen, custom),
    custom,
    setCustom,
    choose,
    periods,
  };
  return { clients, setClients, period };
}
