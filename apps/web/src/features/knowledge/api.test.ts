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
    const q = globalKnowledgeQuery({ clients: ['a', 'b'], type: 'link', q: 'por tal' });
    expect(q.queryKey).toEqual([
      'knowledge',
      'global',
      { clients: ['a', 'b'], type: 'link', q: 'por tal' },
    ]);
    await run(q, 'cur1');
    expect(urlOf(fetchMock)).toBe('/api/knowledge?clients=a%2Cb&type=link&q=por+tal&cursor=cur1');
  });

  it('group query passes the cursor and omits empty filters', async () => {
    const fetchMock = mockFetch();
    const q = groupKnowledgeQuery('g1', {});
    expect(q.queryKey).toEqual(['knowledge', 'group', 'g1', {}]);
    await run(q);
    expect(urlOf(fetchMock)).toBe('/api/groups/g1/knowledge');
    expect(q.getNextPageParam({ items: [], nextCursor: 'n' }, [], undefined, [])).toBe('n');
  });
});
