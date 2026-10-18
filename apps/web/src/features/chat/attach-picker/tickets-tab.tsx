import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MESSAGE_MAX_WORK } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ticketsQuery } from '@/features/tickets/api';
import { cn } from '@/lib/utils';
import { ClientTag } from '../client-tag';
import { TicketSummary } from '../work-cards';
import { ClientBar, type CrossClient } from './client-bar';
import { PickRow } from './pick-row';
import { toggled, useSearchText, type PickedTicket } from './picked';

/**
 * The Tickets tab: this group's tickets, newest first, open ones unless "Include resolved" is
 * on; the search finds a number (`123` or `#123`), a subject fragment or the start of a text.
 * With `cross` (the admin group, Phase 34 part D) every client's tickets through the global list,
 * under the client filter and a "Without client" switch, each row naming its client.
 */
export function TicketsTab({
  groupId,
  chosen,
  setChosen,
  cross,
}: {
  groupId: string;
  chosen: PickedTicket[];
  setChosen: (update: (list: PickedTicket[]) => PickedTicket[]) => void;
  cross?: CrossClient | undefined;
}) {
  const { t } = useTranslation();
  const { text, setText, q } = useSearchText();
  const [resolved, setResolved] = useState(false);
  const [noClient, setNoClient] = useState(false);
  const status = resolved ? 'all' : 'open';
  // No client chosen lists nothing (an empty filter would mean the default scope).
  const noClients = !noClient && cross?.clients?.length === 0;
  const query = useInfiniteQuery({
    ...(cross
      ? ticketsQuery(
          { kind: 'global' },
          {
            status,
            ...(q ? { q } : {}),
            ...(noClient ? { noClient: true } : { clients: cross.clients ?? 'all' }),
          },
        )
      : ticketsQuery({ kind: 'group', groupId }, { status, ...(q ? { q } : {}) })),
    enabled: !noClients,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const full = chosen.length >= MESSAGE_MAX_WORK;
  return (
    <>
      {cross && (
        <ClientBar cross={cross} withoutAdminGroup disabled={noClient}>
          <button
            type="button"
            aria-pressed={noClient}
            onClick={() => setNoClient((on) => !on)}
            className={cn(
              'inline-flex h-8 items-center rounded-full px-4 text-tiny font-semibold max-[640px]:min-h-11',
              noClient
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-surface-3',
            )}
          >
            {t('chat.attach.clients.withoutClient')}
          </button>
        </ClientBar>
      )}
      <Input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('chat.work.searchTickets')}
        aria-label={t('chat.work.searchTickets')}
      />
      <label className="flex items-center gap-2 text-micro text-muted-foreground">
        <input
          type="checkbox"
          checked={resolved}
          onChange={(e) => setResolved(e.target.checked)}
          className="size-4 accent-brand-purple"
        />
        {t('chat.work.includeResolved')}
      </label>
      <ul
        role="list"
        className="-mx-2 min-h-0 flex-1 overflow-y-auto"
        aria-busy={query.isPending && !noClients}
      >
        {items.map((item) => {
          const on = chosen.some((c) => c.id === item.id);
          return (
            <PickRow
              key={item.id}
              checked={on}
              disabled={!on && full}
              onChange={() =>
                setChosen((list) =>
                  toggled(
                    list,
                    {
                      id: item.id,
                      available: true,
                      groupId: item.groupId,
                      number: item.number,
                      subject: item.subject,
                      status: item.status,
                      assignees: item.assignees.slice(0, 3),
                    },
                    MESSAGE_MAX_WORK,
                  ),
                )
              }
            >
              <TicketSummary
                ticket={{
                  id: item.id,
                  available: true,
                  groupId: item.groupId,
                  number: item.number,
                  subject: item.subject,
                  status: item.status,
                  assignees: item.assignees.slice(0, 3),
                }}
                client={
                  cross ? (
                    <ClientTag groupId={item.groupId} directory={cross.directory} />
                  ) : undefined
                }
              />
            </PickRow>
          );
        })}
        {(query.isSuccess || noClients) && items.length === 0 && (
          <li className="px-2 py-4 text-body text-muted-foreground">
            {q ? t('chat.work.noResults') : t('chat.work.noTickets')}
          </li>
        )}
        {query.isError && (
          <li role="alert" className="px-2 py-4 text-body text-error-ink">
            {t('errors.generic')}
          </li>
        )}
        {query.hasNextPage && (
          <li className="px-2 py-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t('chat.knowledge.loadMore')}
            </Button>
          </li>
        )}
      </ul>
      {full && (
        <p className="text-micro text-muted-foreground">
          {t('chat.work.limitTickets', { count: MESSAGE_MAX_WORK })}
        </p>
      )}
    </>
  );
}
