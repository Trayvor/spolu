import { afterEach, describe, expect, it, vi } from 'vitest';
import { globalKnowledgeQuery, groupKnowledgeQuery } from './api';

const page = { items: [], nextCursor: null };

function mockFetch() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(page)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const run = (options: { queryFn?: unknown }, pageParam?: string) =>
  (options.queryFn as (c: unknown) => Promise<unknown>)({ pageParam });

const urlOf = (m: { mock: { calls: unknown[] } }) => (m.mock.calls as string[][])[0]![0];

afterEach(() => vi.unstubAllGlobals());

describe('knowledge api', () => {
  it('global query joins clients with commas', async () => {
    const fetchMock = mockFetch();
    const q = globalKnowledgeQuery({ clients: ['a', 'b'], types: ['note', 'link'], q: 'por tal' });
    expect(q.queryKey).toEqual([
      'knowledge',
      'global',
      { clients: ['a', 'b'], types: ['note', 'link'], q: 'por tal' },
    ]);
    await run(q, 'cur1');
    expect(urlOf(fetchMock)).toBe(
      '/api/knowledge?clients=a%2Cb&type=note%2Clink&q=por+tal&cursor=cur1',
    );
  });

  it('global query sends scope=all instead of ids', async () => {
    const fetchMock = mockFetch();
    await run(globalKnowledgeQuery({ scope: 'all', q: 'x' }));
    expect(urlOf(fetchMock)).toBe('/api/knowledge?scope=all&q=x');
  });

  it('group query passes the cursor and omits empty filters', async () => {
    const fetchMock = mockFetch();
    const q = groupKnowledgeQuery('g1', {});
    expect(q.queryKey).toEqual(['knowledge', 'group', 'g1', {}]);
    await run(q);
    expect(urlOf(fetchMock)).toBe('/api/groups/g1/knowledge');
    expect(q.getNextPageParam({ items: [], nextCursor: 'n' }, [], undefined, [])).toBe('n');
  });

  it('group query sends the types as one comma list, none when the list is empty', async () => {
    const fetchMock = mockFetch();
    await run(groupKnowledgeQuery('g1', { types: ['file', 'reminder'] }));
    await run(groupKnowledgeQuery('g1', { types: [] }));
    const urls = (fetchMock.mock.calls as unknown as string[][]).map((c) => c[0]);
    expect(urls).toEqual([
      '/api/groups/g1/knowledge?type=file%2Creminder',
      '/api/groups/g1/knowledge',
    ]);
  });
});
