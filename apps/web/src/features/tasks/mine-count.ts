import { queryOptions } from '@tanstack/react-query';
import { MineCountSchema } from '@spolu/shared';
import { apiGet } from '@/lib/api';

// Imported eagerly by the group layout (through the Tasks tab badge): keep it tiny.

/** How many open tasks of the group are assigned to me (the Tasks tab's yellow pill). */
export const mineCountQuery = (groupId: string) =>
  queryOptions({
    queryKey: ['tasks', groupId, 'mine'],
    queryFn: () =>
      apiGet(`/groups/${encodeURIComponent(groupId)}/tasks/mine-count`, MineCountSchema),
  });
