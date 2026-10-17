import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { KnowledgeSummary } from '@spolu/shared';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeCard } from './knowledge-card';

const item = (over: Partial<KnowledgeSummary> = {}): KnowledgeSummary => ({
  id: 'k1',
  groupId: 'g1',
  type: 'note',
  visibility: 'public',
  title: 'Checklist',
  excerpt: 'Before submitting:\n• check the budget table\n• sign the form…',
  url: null,
  file: null,
  fileCount: 0,
  nextReminderAt: null,
  upcomingCount: 0,
  lastReminderAt: null,
  createdBy: { id: 'u1', name: 'Jana Nováková' },
  createdAt: '2026-10-14T10:00:00.000Z',
  updatedAt: '2026-10-14T10:00:00.000Z',
  folderId: null,
  folderPath: [],
  ...over,
});

describe('KnowledgeCard', () => {
  it('shows the title, several lines of the excerpt, the author and the file count', () => {
    const { container } = render(<KnowledgeCard item={item({ fileCount: 2 })} onOpen={vi.fn()} />);
    expect(screen.getByText('Checklist')).toHaveClass('line-clamp-2');
    const excerpt = container.querySelector('[data-slot="card-excerpt"]')!;
    expect(excerpt.textContent).toBe(item().excerpt);
    expect(excerpt).toHaveClass('line-clamp-5', 'whitespace-pre-line');
    expect(screen.getByText('Jana Nováková')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '2 attached files' })).toBeInTheDocument();
  });

  it('no excerpt, no empty paragraph', () => {
    const { container } = render(<KnowledgeCard item={item({ excerpt: '' })} onOpen={vi.fn()} />);
    expect(container.querySelector('[data-slot="card-excerpt"]')).toBeNull();
  });

  it('the whole card opens the item; the file link does not', async () => {
    const onOpen = vi.fn();
    const file = { id: 'f1', name: 'budget.xlsx', mime: 'application/x-xlsx', size: 48_000 };
    render(<KnowledgeCard item={item({ type: 'file', file: file as never })} onOpen={onOpen} />);
    const user = userEvent.setup();
    const link = screen.getByRole('link', { name: 'budget.xlsx' });
    link.addEventListener('click', (e) => e.preventDefault());
    await user.click(link);
    expect(onOpen).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Open Checklist' }));
    expect(onOpen).toHaveBeenCalledWith('k1');
  });

  it('keyboard: Enter on the card opens it', async () => {
    const onOpen = vi.fn();
    render(<KnowledgeCard item={item()} onOpen={onOpen} />);
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Open Checklist' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith('k1');
  });

  it('admins-only badge, the group and the folder path when asked', () => {
    render(
      <KnowledgeCard
        item={item({
          visibility: 'admins',
          group: { id: 'g1', name: 'Acme Ltd', logoUrl: null },
          folderPath: [
            { id: 'f1', name: 'Grants' },
            { id: 'f2', name: '2026' },
          ],
        })}
        onOpen={vi.fn()}
        showGroup
        showPath
      />,
    );
    expect(screen.getByText('Only eGrant')).toBeInTheDocument();
    expect(screen.getByText('Acme Ltd')).toBeInTheDocument();
    expect(screen.getByText('Grants / 2026')).toBeInTheDocument();
  });

  it('a reminder shows its next time', () => {
    const at = new Date(2030, 9, 20, 14, 0).toISOString();
    render(
      <KnowledgeCard
        item={item({ type: 'reminder', nextReminderAt: at, upcomingCount: 3 })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('and 2 more')).toBeInTheDocument();
  });
});
