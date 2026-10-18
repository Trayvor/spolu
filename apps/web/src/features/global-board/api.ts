import { queryOptions } from '@tanstack/react-query';
import { GlobalBoardSchema, type GlobalBoard } from '@spolu/shared';
import { apiGet } from '@/lib/api';

/** The board's filters as the API takes them (the URL's, minus the open task). */
export type GlobalFilters = {
  clients?: string;
  assignee?: string;
  urgent?: boolean;
  /** Only the tasks the viewer created or is an assignee of. */
  mine?: boolean;
  due?: 'overdue' | 'week' | 'none';
  q?: string;
  completed?: boolean;
  /** Phase 33 part P2: `<id>|none`, only with exactly one client in `clients`. */
  project?: string;
};

function queryString(filters: GlobalFilters, page?: { column: string; after: string }) {
  const params = new URLSearchParams();
  if (filters.clients) params.set('clients', filters.clients);
  if (filters.assignee && filters.assignee !== 'anyone') params.set('assignee', filters.assignee);
  if (filters.urgent) params.set('urgent', '1');
  if (filters.mine) params.set('mine', '1');
  if (filters.due) params.set('due', filters.due);
  if (filters.q) params.set('q', filters.q);
  if (filters.completed) params.set('completed', '1');
  if (filters.project) params.set('project', filters.project);
  if (page) {
    params.set('column', page.column);
    params.set('after', page.after);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const globalBoardKey = ['tasks', 'global'] as const;

/** The first page of every column for these filters (one request). */
export const globalBoardQuery = (filters: GlobalFilters) =>
  queryOptions({
    queryKey: [...globalBoardKey, filters],
    queryFn: () => apiGet(`/tasks/global${queryString(filters)}`, GlobalBoardSchema),
    refetchOnWindowFocus: true,
  });

/** "Show 50 more": the next page of one column, by its id (`todo`, `custom:<key>`…). */
export function fetchColumnPage(
  filters: GlobalFilters,
  column: string,
  after: string,
): Promise<GlobalBoard> {
  return apiGet(`/tasks/global${queryString(filters, { column, after })}`, GlobalBoardSchema);
}
