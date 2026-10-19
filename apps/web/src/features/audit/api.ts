import { infiniteQueryOptions } from '@tanstack/react-query';
import { AuditPageSchema, type AuditPage } from '@spolu/shared';
import { apiGet } from '@/lib/api';
import type { AuditSearch } from './search';

/** The filters sent to `GET /api/audit` (the URL's, without the chip label). */
export type AuditFilters = Omit<AuditSearch, 'label'>;

export function auditFilters(search: AuditSearch): AuditFilters {
  const { label: _label, ...filters } = search;
  void _label;
  return Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v !== undefined && v !== ''),
  ) as AuditFilters;
}

/** The log, newest first, 50 a page; "Načítať staršie" asks for the next with the cursor. */
export const auditQuery = (filters: AuditFilters) =>
  infiniteQueryOptions({
    queryKey: ['audit', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams(filters as Record<string, string>);
      if (pageParam) params.set('cursor', pageParam);
      const query = params.toString();
      return (await apiGet(`/audit${query ? `?${query}` : ''}`, AuditPageSchema)) as AuditPage;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
