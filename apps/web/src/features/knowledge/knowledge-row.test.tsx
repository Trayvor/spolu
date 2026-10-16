import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { KnowledgeSummary } from '@spolu/shared';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeRow } from './knowledge-row';

const item = (over: Partial<KnowledgeSummary> = {}): KnowledgeSummary => ({
  id: 'k1',
  groupId: 'g1',
  type: 'note',
  visibility: 'public',
  title: 'Checklist',
  excerpt: 'Before submitting, check the budget table…',
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
const FILE = { id: 'f1', name: 'budget.xlsx', mime: 'application/x-xlsx', size: 48_000 };
const at = (d: number) => new Date(2030, 9, d, 14, 0).toISOString();

describe('KnowledgeRow', () => {
  it('note shows the excerpt truncated and the paperclip count, nothing at 0', () => {
    const { rerender } = render(<KnowledgeRow item={item({ fileCount: 3 })} onOpen={vi.fn()} />);
    expect(screen.getByText(/Before submitting/)).toHaveClass('truncate');
    expect(screen.getByText('3')).toBeInTheDocument();
    rerender(<KnowledgeRow item={item()} onOpen={vi.fn()} />);
    expect(screen.queryByText('3')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/attached/)).not.toBeInTheDocument();
  });

  it('clicking the file name or the URL does not call onOpen', async () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <KnowledgeRow item={item({ type: 'file', file: FILE as never })} onOpen={onOpen} />,
    );
    const user = userEvent.setup();
    const file = screen.getByRole('link', { name: 'budget.xlsx' });
    expect(file).toHaveAttribute('href', '/api/files/f1');
    file.addEventListener('click', (e) => e.preventDefault());
    await user.click(file);
    rerender(
      <KnowledgeRow item={item({ type: 'link', url: 'https://www.opvai.sk/x' })} onOpen={onOpen} />,
    );
    const link = screen.getByRole('link', { name: 'opvai.sk/x' });
    link.addEventListener('click', (e) => e.preventDefault());
    await user.click(link);
    expect(onOpen).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Open Checklist' }));
    expect(onOpen).toHaveBeenCalledWith('k1');
  });

  it('the URL link opens in a new tab with noopener', () => {
    render(<KnowledgeRow item={item({ type: 'link', url: 'https://a.sk/b' })} onOpen={vi.fn()} />);
    const link = screen.getByRole('link', { name: 'a.sk/b' });
    expect(link).toHaveAttribute('href', 'https://a.sk/b');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('the reminder leaf shows the next date and "and 2 more"', () => {
    render(
      <KnowledgeRow
        item={item({
          type: 'reminder',
          nextReminderAt: at(23),
          upcomingCount: 3,
          lastReminderAt: at(23),
        })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getAllByText('23')).not.toHaveLength(0);
    expect(screen.getByText(/23 Oct, 14:00/)).toBeInTheDocument();
    expect(screen.getByText(/and 2 more/)).toBeInTheDocument();
  });

  it('with no upcoming time the leaf is muted and line 2 reads Done', () => {
    const { container } = render(
      <KnowledgeRow
        item={item({
          type: 'reminder',
          nextReminderAt: null,
          upcomingCount: 0,
          lastReminderAt: at(5),
        })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="calendar-leaf"]')).toHaveAttribute(
      'data-muted',
      'true',
    );
  });

  it('admins-only shows the Only eGrant badge', () => {
    const { rerender } = render(
      <KnowledgeRow item={item({ visibility: 'admins' })} onOpen={vi.fn()} />,
    );
    expect(screen.getByText('Only eGrant')).toBeInTheDocument();
    rerender(<KnowledgeRow item={item()} onOpen={vi.fn()} />);
    expect(screen.queryByText('Only eGrant')).not.toBeInTheDocument();
  });

  it('showGroup puts the group name first', () => {
    const group = { id: 'g1', name: 'Acme Ltd', logoUrl: null };
    const { container } = render(
      <KnowledgeRow item={item({ group })} onOpen={vi.fn()} showGroup />,
    );
    const meta = container.querySelector('.text-micro.text-muted-foreground:last-child')!;
    expect(meta.textContent!.indexOf('Acme Ltd')).toBeLessThan(meta.textContent!.indexOf('Jana'));
  });

  it('adds an ellipsis when the excerpt was cut at 140 characters', () => {
    const long = 'a'.repeat(140);
    const { rerender } = render(<KnowledgeRow item={item({ excerpt: long })} onOpen={vi.fn()} />);
    expect(screen.getByText(`${long}…`)).toBeInTheDocument();
    rerender(<KnowledgeRow item={item({ excerpt: 'short' })} onOpen={vi.fn()} />);
    expect(screen.getByText('short')).toBeInTheDocument();
  });

  it('the paperclip count is an image with a label', () => {
    render(<KnowledgeRow item={item({ fileCount: 2 })} onOpen={vi.fn()} />);
    expect(screen.getByRole('img', { name: '2 attached files' })).toBeInTheDocument();
  });

  it('a reminder without times uses the bell, not the note icon', () => {
    const { container } = render(
      <KnowledgeRow item={item({ type: 'reminder' })} onOpen={vi.fn()} />,
    );
    expect(container.querySelector('[data-icon="bell"]')).toBeInTheDocument();
    expect(container.querySelector('[data-icon="note"]')).not.toBeInTheDocument();
  });
});
