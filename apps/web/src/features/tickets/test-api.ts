import { vi } from 'vitest';
import type { TicketDto, TicketListItem } from '@spolu/shared';

/** Tests only: fake data and a fake API for the ticket screens. */

export const NOW = '2026-10-16T10:00:00.000Z';
export const ADMIN = {
  id: 'a1',
  name: 'Ada',
  email: 'a@x.sk',
  role: 'admin',
  finance: false,
  groups: [],
};
export const CLIENT = {
  id: 'c1',
  name: 'Klára',
  email: 'k@x.sk',
  role: 'client',
  finance: false,
  groups: [{ id: 'g1', name: 'ABC s.r.o.', role: 'client', hasLogo: false, updatedAt: NOW }],
};
export const REQUESTER = {
  id: 'z1',
  name: 'Žofia',
  email: 'z@x.sk',
  role: 'client',
  finance: false,
  groups: [{ id: 'g1', name: 'ABC s.r.o.', role: 'ziadatel', hasLogo: false, updatedAt: NOW }],
};
export const GROUPS = [
  { id: 'g1', name: 'ABC s.r.o.', managedByMe: true },
  { id: 'g2', name: 'Obec Lúky', managedByMe: false },
].map((g) => ({ ...g, hasLogo: false, memberCount: 1, updatedAt: NOW, managers: [] }));

export const item = (over: Partial<TicketListItem> & { id: string }): TicketListItem => ({
  number: 100,
  groupId: 'g1',
  groupName: 'ABC s.r.o.',
  status: 'new',
  area: null,
  subject: `Ticket ${over.id}`,
  dueDate: null,
  createdAt: NOW,
  requesterName: 'Jana',
  excerpt: null,
  assignees: [],
  ...over,
});

export const ticket = (over: Partial<TicketDto> = {}): TicketDto => ({
  id: 'k1',
  number: 123,
  groupId: 'g1',
  groupName: 'ABC s.r.o.',
  status: 'new',
  source: 'api',
  requester: { userId: 'z1', name: 'Žofia', email: 'z@x.sk', phone: '+421 900 000 000' },
  area: 'Login',
  subject: 'Cannot submit the application',
  programme: 'APVV',
  body: 'The form shows an error.',
  dueDate: null,
  url: null,
  instanceUrl: 'https://abc.egrant.sk',
  files: [],
  createdBy: null,
  createdAt: NOW,
  updatedAt: NOW,
  resolvedAt: null,
  taskCount: 0,
  tasks: [],
  channelId: null,
  assignees: [],
  canAssign: false,
  ...over,
});

export type Route = (url: URL, init?: RequestInit) => Response | undefined;

export const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

/** Stubs `fetch`: `routes` first, then 404; records every call as "METHOD /path?query". */
export function mockTicketApi(me: unknown, routes: Route[] = []) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    if (url.pathname === '/api/me') return reply(200, me);
    for (const route of routes) {
      const answer = route(url, init);
      if (answer) return answer;
    }
    if (url.pathname === '/api/groups') return reply(200, GROUPS);
    if (url.pathname === '/api/knowledge/scope') return reply(200, { managedGroupIds: ['g1'] });
    return reply(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

/** A fake socket whose events the test fires with `emit`. */
export function fakeSocket() {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  return {
    connected: true,
    on(event: string, handler: (payload: unknown) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off(event: string, handler: (payload: unknown) => void) {
      handlers.get(event)?.delete(handler);
    },
    emit: vi.fn(),
    fire(event: string, payload?: unknown) {
      handlers.get(event)?.forEach((h) => h(payload));
    },
  };
}
