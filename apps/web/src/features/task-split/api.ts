import { queryOptions } from '@tanstack/react-query';
import { AiStatusSchema } from '@spolu/shared';
import { apiGet } from '@/lib/api';

/**
 * Which AI features the server runs; it only changes with a server restart. The calls that
 * propose and create tasks are in `split-api.ts`, which only the lazy review dialog imports.
 */
export const aiStatusQuery = queryOptions({
  queryKey: ['ai', 'status'],
  queryFn: () => apiGet('/ai/status', AiStatusSchema),
  staleTime: Infinity,
});
