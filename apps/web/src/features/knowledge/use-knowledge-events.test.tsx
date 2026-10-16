import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useInfiniteQuery } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeEvents, type KnowledgeSummary, type KnowledgeType } from '@spolu/shared';
import { GroupRoomProvider } from '@/features/groups/use-group-room';
import { deleteKnowledge, groupKnowledgeQuery } from './api';
import { useKnowledgeEvents } from './use-knowledge-events';

const fake = vi.hoisted(() => {
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  return {
    on: (e: string, fn: (p: unknown) => void) => {
      if (!listeners.has(e)) listeners.set(e, new Set());
      listeners.get(e)!.add(fn);
    },
    off: (e: string, fn: (p: unknown) => void) => void listeners.get(e)?.delete(fn),
    fire: (e: string, p: unknown) => listeners.get(e)?.forEach((fn) => fn(p)),
    reset: () => listeners.clear(),
  };
});
vi.mock('@/lib/socket', () => ({ getSocket: () => fake }));

function summary(id: string, overrides: Partial<KnowledgeSummary> = {}): KnowledgeSummary {
  return {
    id,
    groupId: 'g1',
    type: 'note',
    visibility: 'public',
    title: id,
    excerpt: '',
    url: null,
    file: null,
    fileCount: 0,
    nextReminderAt: null,
    upcomingCount: 0,
    lastReminderAt: null,
    createdBy: { id: 'u1', name: 'Anna' },
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
    ...overrides,
  };
}

type Filter = { types?: KnowledgeType[]; q?: string };

let fetchMock: ReturnType<typeof vi.fn>;
let client: QueryClient;
const onOpenGone = vi.fn();

function Probe({
  filter,
  openId,
  canSeeAdmins = true,
}: {
  filter: Filter;
  openId?: string;
  canSeeAdmins?: boolean;
}) {
  useKnowledgeEvents('g1', filter, openId, onOpenGone, canSeeAdmins);
  useInfiniteQuery(groupKnowledgeQuery('g1', filter));
  return null;
}
function tree(filter: Filter, joins = 1, openId?: string, canSeeAdmins = true) {
  return (
    <QueryClientProvider client={client}>
      <GroupRoomProvider joins={joins}>
        <Probe filter={filter} openId={openId} canSeeAdmins={canSeeAdmins} />
      </GroupRoomProvider>
    </QueryClientProvider>
  );
}

const cachedIds = (filter: Filter) =>
  client
    .getQueryData<{ pages: { items: KnowledgeSummary[] }[] }>(
      groupKnowledgeQuery('g1', filter).queryKey,
    )
    ?.pages.flatMap((p) => p.items.map((i) => i.id));

async function mount(filter: Filter, openId?: string, canSeeAdmins = true) {
  const view = render(tree(filter, 1, openId, canSeeAdmins));
  await waitFor(() => expect(cachedIds(filter)).toEqual(['k1']));
  return view;
}

describe('useKnowledgeEvents', () => {
  beforeEach(() => {
    fake.reset();
    onOpenGone.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ items: [summary('k1')], nextCursor: null })),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  it('socket upsert adds the item', async () => {
    await mount({});
    act(() => fake.fire(KnowledgeEvents.item, { item: summary('k2') }));
    expect(cachedIds({})).toEqual(['k2', 'k1']);
    // An item of another group is ignored.
    act(() => fake.fire(KnowledgeEvents.item, { item: summary('k3', { groupId: 'g2' }) }));
    expect(cachedIds({})).toEqual(['k2', 'k1']);
  });

  it('a client removes an item that became admins-only instead of showing it', async () => {
    await mount({}, undefined, false);
    act(() => fake.fire(KnowledgeEvents.item, { item: summary('k1', { visibility: 'admins' }) }));
    expect(cachedIds({})).toEqual([]);
    act(() => fake.fire(KnowledgeEvents.item, { item: summary('k2', { visibility: 'admins' }) }));
    expect(cachedIds({})).toEqual([]);
  });

  it('an admin upserts an admins-only item', async () => {
    await mount({});
    act(() => fake.fire(KnowledgeEvents.item, { item: summary('k2', { visibility: 'admins' }) }));
    expect(cachedIds({})).toEqual(['k2', 'k1']);
  });

  it('with several types ticked, an item of any of them is upserted and others are dropped', async () => {
    await mount({ types: ['note', 'reminder'] });
    act(() => fake.fire(KnowledgeEvents.item, { item: summary('k2', { type: 'reminder' }) }));
    act(() => fake.fire(KnowledgeEvents.item, { item: summary('k3', { type: 'link' }) }));
    expect(cachedIds({ types: ['note', 'reminder'] })).toEqual(['k2', 'k1']);
  });

  it('an empty type list matches every type', async () => {
    await mount({ types: [] });
    act(() => fake.fire(KnowledgeEvents.item, { item: summary('k2', { type: 'link' }) }));
    expect(cachedIds({ types: [] })).toEqual(['k2', 'k1']);
  });

  it('another type is dropped', async () => {
    await mount({ types: ['note'] });
    act(() => fake.fire(KnowledgeEvents.item, { item: summary('k2', { type: 'link' }) }));
    expect(cachedIds({ types: ['note'] })).toEqual(['k1']);
    act(() => fake.fire(KnowledgeEvents.item, { item: summary('k3', { type: 'note' }) }));
    expect(cachedIds({ types: ['note'] })).toEqual(['k3', 'k1']);
  });

  it('a known item that changed to another type leaves the filtered list', async () => {
    await mount({ types: ['note'] });
    act(() => fake.fire(KnowledgeEvents.item, { item: summary('k1', { type: 'link' }) }));
    expect(cachedIds({ types: ['note'] })).toEqual([]);
  });

  it('with a search the list is invalidated', async () => {
    await mount({ q: 'budget' });
    const before = fetchMock.mock.calls.length;
    act(() => fake.fire(KnowledgeEvents.item, { item: summary('k2') }));
    expect(cachedIds({ q: 'budget' })).toEqual(['k1']);
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(before + 1));
  });

  it('item_deleted removes it', async () => {
    await mount({});
    act(() => fake.fire(KnowledgeEvents.itemDeleted, { groupId: 'g1', id: 'k1' }));
    expect(cachedIds({})).toEqual([]);
    expect(onOpenGone).not.toHaveBeenCalled();
  });

  it('an open item deleted by a socket event closes with the notice', async () => {
    await mount({}, 'k1');
    act(() => fake.fire(KnowledgeEvents.itemDeleted, { groupId: 'g1', id: 'k1' }));
    expect(onOpenGone).toHaveBeenCalledTimes(1);
  });

  it("the viewer's own delete closes without the notice", async () => {
    await mount({}, 'k1');
    let answer: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (answer = r)));
    const deleting = deleteKnowledge('k1');
    // The socket event comes before the HTTP answer.
    act(() => fake.fire(KnowledgeEvents.itemDeleted, { groupId: 'g1', id: 'k1' }));
    expect(onOpenGone).not.toHaveBeenCalled();
    expect(cachedIds({})).toEqual([]);
    answer(new Response(null, { status: 204 }));
    await deleting;
  });

  it('refetches the first page after a rejoin', async () => {
    const view = await mount({});
    const before = fetchMock.mock.calls.length;
    view.rerender(tree({}, 2));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(before + 1));
  });
});
