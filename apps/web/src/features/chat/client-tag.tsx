import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ClientLogo,
  ManagedDot,
  toClientOptions,
  type ClientOption,
} from '@/components/client-filter';
import { groupsQuery } from '@/features/groups/api';

/** The groups an admin sees, by id, with whether they manage each (Phase 34 part D). */
export type ClientDirectory = {
  options: ClientOption[];
  byId: Map<string, ClientOption>;
  managedIds: string[];
};

/**
 * The client filter's options and the "my clients" ids from `/api/groups` (cached for the
 * sidebar); `enabled` false (a client group's chat) asks nothing.
 */
export function useClientDirectory(enabled: boolean): ClientDirectory | undefined {
  const groups = useQuery({ ...groupsQuery, enabled }).data;
  return useMemo(() => {
    if (!groups) return undefined;
    const options = toClientOptions(groups, true);
    return {
      options,
      byId: new Map(options.map((o) => [o.id, o])),
      managedIds: groups.filter((g) => g.managedByMe).map((g) => g.id),
    };
  }, [groups]);
}

/**
 * The client of a result row or card in the admin group: its 24 px logo and name, the manager
 * dot when the viewer manages it, or "Without client" for a ticket without one.
 */
export function ClientTag({
  groupId,
  directory,
}: {
  groupId: string | null;
  directory: ClientDirectory | undefined;
}) {
  const { t } = useTranslation();
  if (groupId === null) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-micro text-muted-foreground">
        <span
          aria-hidden="true"
          className="size-4 shrink-0 rounded border border-dashed border-muted-foreground"
        />
        {t('chat.attach.clients.withoutClient')}
      </span>
    );
  }
  const client = directory?.byId.get(groupId);
  if (!client) return null;
  const mine = !client.internal && directory!.managedIds.includes(groupId);
  return (
    <span
      data-client-tag=""
      className="flex min-w-0 items-center gap-1.5 text-micro text-muted-foreground [&>img]:size-4 [&>span:first-child]:size-4"
    >
      <ClientLogo client={client} />
      <span className="truncate">{client.name}</span>
      {mine && (
        <>
          <ManagedDot />
          <span className="sr-only">{t('chat.attach.clients.mine')}</span>
        </>
      )}
    </span>
  );
}
