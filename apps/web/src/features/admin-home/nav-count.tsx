import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { homeKeys, navCountsQuery } from './api';
import { useAdminActivityRefetch } from './use-admin-activity';

// The lazy `nav-count` chunk: the header loads it for admins only, so the counts' query, schema
// and socket listeners stay out of the entry chunk.

const COUNT_KEYS = [homeKeys.counts] as const;

/**
 * Keeps the header's counts fresh: a task or chat write anywhere (`admin:activity`; a task or
 * ticket chat message is a change too), a ticket created, changed or moved, or the viewer opening
 * a task or ticket (`seen:changed`) refetches them after the usual 2 s debounce. Mounted once, by
 * the header's Tasks count.
 */
function LiveCounts() {
  useAdminActivityRefetch(COUNT_KEYS, { chatRead: false, tickets: true });
  return null;
}

/**
 * A count beside the header's "Tasks" or "Tickets" link (2026-10-17): the tasks or tickets with a
 * change I have not seen yet (a ticket without a client counts for every admin until opened), a
 * small ink pill, `99+` above 99, nothing at 0 or while loading. Both share one request. `live` subscribes to the events that change them.
 */
export default function NavCount({
  kind,
  live = false,
}: {
  kind: 'tasks' | 'tickets';
  live?: boolean;
}) {
  const { t } = useTranslation();
  const { data } = useQuery(navCountsQuery);
  const count = data?.[kind] ?? 0;
  return (
    <>
      {live && <LiveCounts />}
      {count > 0 && (
        <span
          data-testid={`nav-count-${kind}`}
          className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-nano font-semibold text-primary-foreground tabular-nums"
        >
          <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
          <span className="sr-only">{t(`adminHome.navCount.${kind}`, { count })}</span>
        </span>
      )}
    </>
  );
}
