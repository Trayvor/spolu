import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import type { BulkCampaignDto, BulkCampaignListItem, BulkPerson } from '@spolu/shared';
import { createAppRouter } from '@/router';

/** Tests only: fake data, a fake API and a render helper for the bulk email screens. */

export const NOW = '2026-10-16T10:00:00.000Z';
export const ADMIN = { id: 'a1', name: 'Ada', email: 'ada@egrant.sk', role: 'admin', groups: [] };
export const CLIENT = { id: 'c1', name: 'Klára', email: 'k@x.sk', role: 'client', groups: [] };
export const GROUPS = [
  { id: 'g1', name: 'ABC s.r.o.' },
  { id: 'g2', name: 'Obec Lúčky' },
].map((g) => ({
  ...g,
  hasLogo: false,
  memberCount: 1,
  updatedAt: NOW,
  managers: [],
  managedByMe: false,
}));
export const ADMINS = [
  { id: 'a1', name: 'Ada', email: 'ada@egrant.sk', role: 'admin' },
  { id: 'a2', name: 'Boris', email: 'boris@egrant.sk', role: 'admin' },
];
export const EMPTY_AUDIENCE = {
  groupIds: [],
  managerIds: [],
  roles: [],
  includeUserIds: [],
  excludeUserIds: [],
};
const COUNTS = {
  queued: 0,
  sending: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
  cancelled: 0,
  unsubscribed: 0,
};

export const person = (over: Partial<BulkPerson> & { id: string }): BulkPerson => ({
  name: `Person ${over.id}`,
  email: `${over.id}@x.sk`,
  role: 'client',
  groups: ['ABC s.r.o.'],
  ...over,
});

export const listItem = (
  over: Partial<BulkCampaignListItem> & { id: string },
): BulkCampaignListItem => ({
  name: `Campaign ${over.id}`,
  subject: 'Hello',
  status: 'draft',
  recipientCount: null,
  createdAt: NOW,
  updatedAt: NOW,
  sendStartedAt: null,
  finishedAt: null,
  counts: COUNTS,
  createdByName: 'Ada',
  sentByName: null,
  ...over,
});

export const campaign = (over: Partial<BulkCampaignDto> = {}): BulkCampaignDto => ({
  ...listItem({ id: 'k1' }),
  preheader: '',
  blocks: [],
  audience: EMPTY_AUDIENCE,
  version: 3,
  sender: null,
  createdBy: 'a1',
  updatedBy: 'a1',
  sentBy: null,
  ...over,
});

export type Route = (url: URL, init: RequestInit) => Response | undefined;

export const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

export type Call = { method: string; path: string; body: unknown; init: RequestInit };

/** Stubs `fetch`: `routes` first, then the defaults, then 404 `not_found`. */
export function mockBulkApi(me: unknown, routes: Route[] = []) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, 'http://localhost');
    const method = init.method ?? 'GET';
    let body: unknown = init.body;
    if (typeof init.body === 'string') body = JSON.parse(init.body);
    calls.push({ method, path: `${url.pathname}${url.search}`, body, init });
    if (url.pathname === '/api/me') return reply(200, me);
    for (const route of routes) {
      const answer = route(url, init);
      if (answer) return answer;
    }
    if (url.pathname === '/api/groups') return reply(200, GROUPS);
    if (url.pathname === '/api/admins') return reply(200, ADMINS);
    if (url.pathname === '/api/bulk-email/audience/count') {
      return reply(200, { count: 0, leftOut: { unsubscribed: 0, disabled: 0 } });
    }
    if (url.pathname.endsWith('/preview')) return reply(200, { html: '<p>Preview</p>' });
    return reply(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  const callsTo = (method: string, path: string) =>
    calls.filter((c) => c.method === method && c.path.startsWith(path));
  return { calls, callsTo, fetchMock };
}

export function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(RouterProvider, { router }),
    ),
  );
  return { user: userEvent.setup(), router, queryClient };
}

/** A fake socket whose events the test fires. */
export function makeSocket() {
  const listeners = new Map<string, Set<(payload?: unknown) => void>>();
  return {
    connected: true,
    connect: vi.fn(),
    disconnect: vi.fn(),
    emit: vi.fn(),
    on(event: string, fn: (payload?: unknown) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    off(event: string, fn: (payload?: unknown) => void) {
      listeners.get(event)?.delete(fn);
    },
    fire(event: string, payload?: unknown) {
      listeners.get(event)?.forEach((fn) => fn(payload));
    },
    reset: () => listeners.clear(),
  };
}
