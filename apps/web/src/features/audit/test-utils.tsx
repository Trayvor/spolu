import { vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import type { AuditEntryDto, AuditPage } from '@spolu/shared';
import { createAppRouter } from '@/router';

export const ADMIN = {
  id: 'a1',
  name: 'Jana Nováková',
  email: 'jana@example.com',
  role: 'admin',
  finance: false,
  groups: [],
};

export const entry = (over: Partial<AuditEntryDto> = {}): AuditEntryDto => ({
  id: `e-${Math.random().toString(36).slice(2)}`,
  createdAt: '2026-10-19T12:32:00.000Z',
  actor: { kind: 'user', userId: 'a1', name: 'Jana Nováková', deactivated: false },
  entityType: 'task',
  entityId: 't1',
  entityLabel: 'Pripraviť rozpočet',
  linkable: true,
  group: { id: 'g1', name: 'Mesto Senica' },
  action: 'updated',
  changes: {},
  cause: null,
  ...over,
});

/**
 * Fake `fetch`: `/me`, `/groups`, `/admins`, and `/audit` answered by `pages` (by cursor:
 * the first without one, then `c1`, `c2`, …). Returns the audit calls' query strings.
 */
export function mockAuditApi(
  pages: AuditPage[] | ((query: URLSearchParams) => AuditPage | number),
  me: Record<string, unknown> = ADMIN,
) {
  const calls: URLSearchParams[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (url === '/api/me') return reply(200, me);
    if (url === '/api/groups') {
      return reply(200, [
        {
          id: 'g1',
          name: 'Mesto Senica',
          kind: 'client',
          hasLogo: false,
          updatedAt: '2026-01-01T00:00:00Z',
          memberCount: 1,
          managers: [],
          managedByMe: false,
          deactivatedAt: null,
        },
      ]);
    }
    if (url === '/api/admins') {
      return reply(200, [
        { id: 'a1', name: 'Jana Nováková', email: 'jana@example.com', role: 'admin' },
      ]);
    }
    if (url.startsWith('/api/audit')) {
      const query = new URLSearchParams(url.split('?')[1] ?? '');
      calls.push(query);
      if (typeof pages === 'function') {
        const answer = pages(query);
        return typeof answer === 'number' ? reply(answer, { error: 'x' }) : reply(200, answer);
      }
      const cursor = query.get('cursor');
      const index = cursor ? Number(cursor.slice(1)) : 0;
      return reply(200, pages[index] ?? { items: [], nextCursor: null });
    }
    return reply(404, {});
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

export function renderAudit(path = '/audit') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), router };
}
