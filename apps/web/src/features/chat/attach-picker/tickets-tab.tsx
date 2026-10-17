import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MESSAGE_MAX_WORK } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ticketsQuery } from '@/features/tickets/api';
import { TicketSummary } from '../work-cards';
import { PickRow } from './pick-row';
import { toggled, useSearchText, type PickedTicket } from './picked';

/**
 * The Tickets tab: this group's tickets, newest first, open ones unless "Include resolved" is
 * on; the search finds a number (`123` or `#123`), a subject fragment or the start of a text.
 */
export function TicketsTab({
  groupId,
  chosen,
  setChosen,
}: {
  groupId: string;
  chosen: PickedTicket[];
  setChosen: (update: (list: PickedTicket[]) => PickedTicket[]) => void;
}) {
  const { t } = useTranslation();
  const { text, setText, q } = useSearchText();
  const [resolved, setResolved] = useState(false);
  const query = useInfiniteQuery(
    ticketsQuery(
      { kind: 'group', groupId },
      { status: resolved ? 'all' : 'open', ...(q ? { q } : {}) },
    ),
  );
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const full = chosen.length >= MESSAGE_MAX_WORK;
  return (
    <>
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
      <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto" aria-busy={query.isPending}>
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
              />
            </PickRow>
          );
        })}
        {query.isSuccess && items.length === 0 && (
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
