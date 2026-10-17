import { infiniteQueryOptions } from '@tanstack/react-query';
import { TaskSearchPageSchema } from '@spolu/shared';
import { apiGet } from '@/lib/api';

/** Phase 34: the picker's task search in one group, open tasks first, 20 a page. */
export const taskSearchQuery = (groupId: string, q: string) =>
  infiniteQueryOptions({
    queryKey: ['chat', 'attach', 'tasks', groupId, q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams();
      if (q) qs.set('q', q);
      if (pageParam) qs.set('after', pageParam);
      const text = qs.toString();
      return apiGet(
        `/groups/${encodeURIComponent(groupId)}/tasks/search${text ? `?${text}` : ''}`,
        TaskSearchPageSchema,
      );
    },
    getNextPageParam: (page) => page.next ?? undefined,
  });
