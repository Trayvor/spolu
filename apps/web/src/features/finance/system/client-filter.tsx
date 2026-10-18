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
 * The page's client choice: `clients` (empty: every client, now and later) and `internal`, the
 * admin group "eGrant tím (internal)" chosen too (Phase 34 part E, off by default). The admin
 * group alone is `clients: [<its id>]`.
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
    return { clients: clients.split(',').filter(Boolean), internal: saved?.internal === '1' };
  });
  const choose = (next: FinanceClients) => {
    setChoice(next);
    if (!key) return;
    const value = {
      ...(next.clients.length > 0 ? { clients: next.clients.join(',') } : {}),
      ...(next.internal ? { internal: '1' } : {}),
    };
    writeRemembered(key, Object.keys(value).length > 0 ? value : null);
  };
  return [choice, choose];
}

/**
 * The knowledge list's client filter (pill, popover or sheet, chips) over every client, with the
 * admin group as the "eGrant tím" option on top, off by default (Phase 34 part E: internal money
 * is no client revenue). Choosing every client, none, or resetting stores "every client", so
 * clients added later are in too.
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
  const known = new Set(clientIds);
  const chosen = value.clients.filter((id) => known.has(id));
  const onlyInternal = adminId !== null && value.clients.includes(adminId) && chosen.length === 0;
  const internal = adminId !== null && value.internal;

  // The filter's value: null is the default (every client, no internal option).
  const filterValue =
    groups === undefined || (chosen.length === 0 && !internal && !onlyInternal)
      ? null
      : onlyInternal && adminId
        ? [adminId]
        : [...(chosen.length > 0 ? chosen : clientIds), ...(internal && adminId ? [adminId] : [])];

  const change = (next: string[] | null) => {
    if (next === null) return onChange({ clients: [], internal: false });
    const withInternal = adminId !== null && next.includes(adminId);
    const rest = next.filter((id) => id !== adminId);
    if (rest.length === 0) {
      const alone = withInternal && adminId !== null;
      return onChange({ clients: alone ? [adminId] : [], internal: false });
    }
    const every = rest.length === clientIds.length;
    onChange({ clients: every ? [] : rest, internal: withInternal });
  };

  return (
    <ClientFilter
      groups={options}
      managedIds={null}
      value={filterValue}
      disabled={groups === undefined}
      internalInDefault={false}
      onChange={change}
    />
  );
}
