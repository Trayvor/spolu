import { vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Me, Member } from '@spolu/shared';
import { sessionQuery } from '@/features/auth/use-session';
import { MembersList } from './members-list';

export const ADMIN = {
  id: 'a1',
  name: 'Jana',
  email: 'jana@example.com',
  role: 'admin',
  groups: [],
} as Me;

export type Call = { method: string; url: string; body: unknown };
type Reply = { status: number; body?: unknown };

/**
 * Renders the admin's members list of group g1 with a fake API: `members`, `invited` and no
 * removed members; `post` answers `POST /members` (default 201 invited).
 */
export function renderMembers(
  options: { members?: Member[]; invited?: Member[]; post?: (body: unknown) => Reply } = {},
) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
      calls.push({ method, url, body });
      const reply = ({ status, body: out }: Reply) =>
        new Response(out === undefined ? null : JSON.stringify(out), { status });
      if (method === 'GET' && url === '/api/groups/g1/members') {
        return reply({ status: 200, body: options.members ?? [] });
      }
      if (method === 'GET' && url === '/api/groups/g1/members/invited') {
        return reply({ status: 200, body: options.invited ?? [] });
      }
      if (method === 'GET' && url === '/api/groups/g1/members/removed') {
        return reply({ status: 200, body: [] });
      }
      if (method === 'POST' && url === '/api/groups/g1/members') {
        const { email } = body as { email: string };
        return reply(
          options.post?.(body) ?? {
            status: 201,
            body: { member: { id: 'n1', name: '', email }, outcome: 'invited' },
          },
        );
      }
      if (method !== 'GET') return reply({ status: 204 });
      return reply({ status: 404, body: { error: 'not_found' } });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(sessionQuery.queryKey, ADMIN);
  render(
    <QueryClientProvider client={client}>
      <MembersList groupId="g1" admin />
    </QueryClientProvider>,
  );
  const writes = () => calls.filter((c) => c.method !== 'GET');
  return { calls, writes, user: userEvent.setup() };
}
