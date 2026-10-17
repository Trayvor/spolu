import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClientFilter, type ClientOption } from '@/components/client-filter';
import { useSession } from '@/features/auth/use-session';
import { groupsQuery } from '@/features/groups/api';
import {
  readRemembered,
  rememberedFiltersKey,
  writeRemembered,
} from '@/lib/use-remembered-filters';

const LIST = 'finance.clients';

/**
 * The page's client choice (spec §6.2, decision 17): every client by default, remembered per
 * person (`spolu.filters.<userId>.finance.clients`). An empty list means every client, now and
 * later.
 */
export function useFinanceClients(): [string[], (next: string[]) => void] {
  const userId = useSession()?.id ?? null;
  const key = userId === null ? null : rememberedFiltersKey(userId, LIST);
  const [clients, setClients] = useState<string[]>(() => {
    const saved = key ? readRemembered(key)?.clients : undefined;
    return typeof saved === 'string' ? saved.split(',').filter(Boolean) : [];
  });
  const choose = (next: string[]) => {
    setClients(next);
    if (key) writeRemembered(key, next.length > 0 ? { clients: next.join(',') } : null);
  };
  return [clients, choose];
}

/**
 * The knowledge list's client filter (pill, popover or sheet, chips) over every client. Choosing
 * all of them, none, or resetting stores "every client", so clients added later are in too.
 */
export function FinanceClientFilter({
  clients,
  onChange,
}: {
  clients: string[];
  onChange: (next: string[]) => void;
}) {
  const groups = useQuery(groupsQuery).data;
  const options = useMemo<ClientOption[]>(
    () =>
      (groups ?? []).map((group) => ({
        id: group.id,
        name: group.name,
        logoUrl: group.hasLogo
          ? `/api/groups/${encodeURIComponent(group.id)}/logo?v=${encodeURIComponent(group.updatedAt)}`
          : null,
      })),
    [groups],
  );
  const known = new Set(options.map((o) => o.id));
  const chosen = clients.filter((id) => known.has(id));
  return (
    <ClientFilter
      groups={options}
      managedIds={null}
      value={groups === undefined || chosen.length === 0 ? null : chosen}
      disabled={groups === undefined}
      onChange={(next) => onChange(next === null || next.length === options.length ? [] : next)}
    />
  );
}
