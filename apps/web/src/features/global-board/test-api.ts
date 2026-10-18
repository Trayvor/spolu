import { vi } from 'vitest';
import type { GlobalBoard, GlobalTaskDto } from '@spolu/shared';

/** Tests only: a fake API for the global board screens. */

export const ADMIN = {
  id: 'a1',
  name: 'Ada',
  email: 'a@x.sk',
  role: 'admin',
  finance: false,
  groups: [],
};

export const GROUPS = [
  { id: 'g1', name: 'ABC s.r.o.', managedByMe: true },
  { id: 'g2', name: 'Obec Lúky', managedByMe: false },
].map((g) => ({
  ...g,
  hasLogo: false,
  memberCount: 1,
  updatedAt: '2026-10-15T10:00:00.000Z',
  managers: [],
}));

export const card = (over: Partial<GlobalTaskDto> & { id: string }): GlobalTaskDto => ({
  unseen: false,
  groupId: 'g1',
  bucketId: 'b-todo',
  position: over.id,
  title: `Task ${over.id}`,
  urgent: false,
  dueDate: null,
  link: null,
  completedAt: null,
  createdBy: { id: 'a1', name: 'Ada' },
  assignees: [],
  fileCount: 0,
  upcomingReminders: 0,
  knowledgeCount: 0,
  sourceMessageId: null,
  project: null,
  event: null,
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
  groupName: 'ABC s.r.o.',
  groupHasLogo: false,
  groupUpdatedAt: '2026-10-15T10:00:00.000Z',
  bucketKind: 'todo',
  bucketName: null,
  ...over,
});

const fixed = (kind: 'todo' | 'other' | 'egrant_review' | 'client_review' | 'done') =>
  ({ id: kind, kind, name: null }) as const;

/** To do, a merged custom column, Other steps (folded custom buckets), the two reviews. */
export const board = (over: Partial<GlobalBoard> = {}): GlobalBoard => ({
  columns: [
    {
      ...fixed('todo'),
      total: 1,
      items: [card({ id: 't1', title: 'Fix budget table' })],
      next: null,
    },
    {
      id: 'custom:in translation',
      kind: 'custom',
      name: 'In translation',
      total: 1,
      items: [
        card({
          id: 't2',
          title: 'Annex 2',
          bucketKind: 'custom',
          bucketName: 'In Translation',
          groupId: 'g2',
          groupName: 'Obec Lúky',
        }),
      ],
      next: null,
    },
    {
      ...fixed('other'),
      total: 1,
      items: [
        card({ id: 't3', title: 'Old minutes', bucketKind: 'custom', bucketName: 'Archive' }),
      ],
      next: null,
    },
    { ...fixed('egrant_review'), total: 0, items: [], next: null },
    { ...fixed('client_review'), total: 0, items: [], next: null },
  ],
  people: [{ id: 'p1', name: 'Petra' }],
  ...over,
});

export const doneColumn = () => ({ ...fixed('done'), total: 0, items: [], next: null });

export type Route = (url: URL, init?: RequestInit) => Response | undefined;

/** Stubs `fetch`: `routes` first, then the defaults; records every URL. */
export function mockBoardApi(routes: Route[] = []) {
  const calls: string[] = [];
  const reply = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status });
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    calls.push(input);
    const url = new URL(input, 'http://localhost');
    for (const route of routes) {
      const answer = route(url, init);
      if (answer) return answer;
    }
    if (url.pathname === '/api/me') return reply(200, ADMIN);
    if (url.pathname === '/api/groups') return reply(200, GROUPS);
    if (url.pathname === '/api/tasks/global') return reply(200, board());
    return reply(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock, reply };
}
