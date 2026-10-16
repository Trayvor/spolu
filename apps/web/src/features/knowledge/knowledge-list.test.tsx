import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { KnowledgeSummary } from '@spolu/shared';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeList } from './knowledge-list';

const row = (id: string): KnowledgeSummary => ({
  id,
  groupId: 'g1',
  type: 'note',
  visibility: 'public',
  title: `Item ${id}`,
  excerpt: '',
  url: null,
  file: null,
  fileCount: 0,
  nextReminderAt: null,
  upcomingCount: 0,
  lastReminderAt: null,
  createdBy: { id: 'u1', name: 'Jana' },
  createdAt: '2026-10-14T10:00:00.000Z',
  updatedAt: '2026-10-14T10:00:00.000Z',
});
const query = (pages: { items: KnowledgeSummary[]; nextCursor: string | null }[], over = {}) =>
  ({
    data: { pages, pageParams: [] },
    hasNextPage: pages.at(-1)?.nextCursor != null,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    ...over,
  }) as never;

describe('KnowledgeList', () => {
  it('Load more fetches the next cursor', async () => {
    const q = query([{ items: [row('a'), row('b')], nextCursor: 'c1' }]);
    render(<KnowledgeList query={q} onOpen={vi.fn()} empty={<p>none</p>} />);
    expect(screen.getByText('Item a')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect((q as { fetchNextPage: () => void }).fetchNextPage).toHaveBeenCalled();
  });

  it('empty node when no items', () => {
    render(
      <KnowledgeList
        query={query([{ items: [], nextCursor: null }])}
        onOpen={vi.fn()}
        empty={<p>Nothing here yet</p>}
      />,
    );
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });
});
