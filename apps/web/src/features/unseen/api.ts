import { queryOptions } from '@tanstack/react-query';
import { UnseenSummarySchema } from '@spolu/shared';
import { apiGet } from '@/lib/api';

export type UnseenTarget = { kind: 'task' | 'ticket'; id: string };

/**
 * What changed in a task or ticket since the viewer last opened it (2026-10-18), fetched on the
 * first hover, focus or press of its marker, and by the task panel or ticket page before they
 * mark it seen. Short-lived: a list's marker asks again a little later.
 */
export const unseenSummaryQuery = ({ kind, id }: UnseenTarget) =>
  queryOptions({
    queryKey: ['unseen-summary', kind, id],
    queryFn: () =>
      apiGet(
        `/${kind === 'task' ? 'tasks' : 'tickets'}/${encodeURIComponent(id)}/unseen-summary`,
        UnseenSummarySchema,
      ),
    staleTime: 10_000,
    retry: false,
  });
