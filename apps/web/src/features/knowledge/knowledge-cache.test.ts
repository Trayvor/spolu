import { describe, expect, it } from 'vitest';
import type { InfiniteData } from '@tanstack/react-query';
import type { KnowledgePage, KnowledgeSummary } from '@spolu/shared';
import { removeSummary, upsertSummary } from './knowledge-cache';

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
    folderId: null,
    folderPath: [],
    ...overrides,
  };
}

const data = (...pages: string[][]): InfiniteData<KnowledgePage> => ({
  pages: pages.map((ids, i) => ({
    items: ids.map((id) => summary(id)),
    nextCursor: i < pages.length - 1 ? `c${i}` : null,
  })),
  pageParams: pages.map((_, i) => (i === 0 ? undefined : `c${i - 1}`)),
});

const ids = (d: InfiniteData<KnowledgePage>) => d.pages.map((p) => p.items.map((i) => i.id));

describe('knowledge cache', () => {
  it('upsert puts new first and replaces in place', () => {
    const before = data(['a', 'b'], ['c']);
    const added = upsertSummary(before, summary('n'));
    expect(ids(added)).toEqual([['n', 'a', 'b'], ['c']]);
    expect(added.pageParams).toEqual(before.pageParams);

    const replaced = upsertSummary(before, summary('c', { title: 'Changed' }));
    expect(ids(replaced)).toEqual([['a', 'b'], ['c']]);
    expect(replaced.pages[1]!.items[0]!.title).toBe('Changed');
    expect(replaced.pages[0]).toBe(before.pages[0]);
  });

  it('an unknown older item goes in its place, or waits for Load more when past the loaded rows', () => {
    const at = (h: number) => `2026-10-14T${String(h).padStart(2, '0')}:00:00.000Z`;
    const before: InfiniteData<KnowledgePage> = {
      pages: [
        {
          items: [summary('a', { createdAt: at(12) }), summary('b', { createdAt: at(10) })],
          nextCursor: 'c0',
        },
        { items: [summary('c', { createdAt: at(8) })], nextCursor: 'c1' },
      ],
      pageParams: [undefined, 'c0'],
    };
    // Between loaded rows: inserted where the server would list it.
    expect(ids(upsertSummary(before, summary('m', { createdAt: at(9) })))).toEqual([
      ['a', 'b'],
      ['m', 'c'],
    ]);
    // Older than every loaded row while more pages exist: "Load more" brings it, no duplicate.
    expect(upsertSummary(before, summary('old', { createdAt: at(1) }))).toBe(before);
    // With every page loaded it goes last.
    const all = { ...before, pages: [before.pages[0]!, { ...before.pages[1]!, nextCursor: null }] };
    expect(ids(upsertSummary(all, summary('old', { createdAt: at(1) })))).toEqual([
      ['a', 'b'],
      ['c', 'old'],
    ]);
  });

  it('remove', () => {
    const before = data(['a', 'b'], ['c']);
    expect(ids(removeSummary(before, 'b'))).toEqual([['a'], ['c']]);
    expect(removeSummary(before, 'zz')).toBe(before);
  });
});
