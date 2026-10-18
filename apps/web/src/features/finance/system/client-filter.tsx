import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClientFilter, toClientOptions } from '@/components/client-filter';
import { useSession } from '@/features/auth/use-session';
import { groupsQuery } from '@/features/groups/api';
import {
  readRemembered,
  rememberedFiltersKey,
  writeRemembered,
} from '@/lib/use-remembered-filters';

const LIST = 'finance.clients';

/**
 * The page's client choice: `clients` (empty: every client, now and later) and `internal`, whether
 * "every client" includes the admin group "eGrant tím" (Phase 34 part E: on by default, owner
 * decision of 2026-10-18; unticking it leaves the team's time out). Chosen clients name the admin
 * group in `clients` when it is ticked.
 */
export type FinanceClients = { clients: string[]; internal: boolean };

/**
 * The page's client choice (spec §6.2, decision 17): every client by default, remembered per
 * person (`spolu.filters.<userId>.finance.clients`).
 */
export function useFinanceClients(): [FinanceClients, (next: FinanceClients) => void] {
  const userId = useSession()?.id ?? null;
  const key = userId === null ? null : rememberedFiltersKey(userId, LIST);
  const [choice, setChoice] = useState<FinanceClients>(() => {
    const saved = key ? readRemembered(key) : null;
    const clients = typeof saved?.clients === 'string' ? saved.clients : '';
    return { clients: clients.split(',').filter(Boolean), internal: saved?.internal !== '0' };
  });
  const choose = (next: FinanceClients) => {
    setChoice(next);
    if (!key) return;
    const value = {
      ...(next.clients.length > 0 ? { clients: next.clients.join(',') } : {}),
      ...(next.clients.length === 0 && !next.internal ? { internal: '0' } : {}),
    };
    writeRemembered(key, Object.keys(value).length > 0 ? value : null);
  };
  return [choice, choose];
}

/**
 * The knowledge list's client filter (pill, popover or sheet, chips) over every client, with the
 * admin group as the "eGrant tím" option on top, ticked by default (Phase 34 part E). Choosing
 * every client (with the team), none, or resetting stores "every client", so clients added later
 * are in too.
 */
export function FinanceClientFilter({
  value,
  onChange,
}: {
  value: FinanceClients;
  onChange: (next: FinanceClients) => void;
}) {
  const groups = useQuery(groupsQuery).data;
  const options = useMemo(() => toClientOptions(groups ?? [], true), [groups]);
  const adminId = options.find((o) => o.internal)?.id ?? null;
  const clientIds = options.filter((o) => !o.internal).map((o) => o.id);
  const known = new Set(options.map((o) => o.id));
  const chosen = value.clients.filter((id) => known.has(id));

  // The filter's value: null is the default (every client and the team).
  const filterValue =
    groups === undefined || (chosen.length === 0 && (value.internal || adminId === null))
      ? null
      : chosen.length > 0
        ? chosen
        : clientIds;

  const change = (next: string[] | null) => {
    if (next === null || next.length === 0) return onChange({ clients: [], internal: true });
    const withTeam = adminId !== null && next.includes(adminId);
    const every = clientIds.every((id) => next.includes(id));
    onChange(
      every
        ? { clients: [], internal: withTeam || adminId === null }
        : { clients: next, internal: true },
    );
  };

  return (
    <ClientFilter
      groups={options}
      managedIds={null}
      value={filterValue}
      disabled={groups === undefined}
      onChange={change}
    />
  );
}
