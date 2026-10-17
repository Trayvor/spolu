import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@/i18n';
import { CountCard, type CountCardProps } from './count-card';
import { renderWithRouter } from './test-router';

const t = (key: string) => i18n.t(key);

const props = (over: Partial<CountCardProps> = {}): CountCardProps => ({
  id: 'tasks',
  title: 'Assigned to me',
  count: 37,
  caption: 'assigned',
  subline: <span>5 urgent</span>,
  rows: [
    {
      key: 'a',
      to: { to: '/groups/$groupId/tasks/$taskId', params: { groupId: 'g1', taskId: 't1' } },
      content: <span>Fix budget table</span>,
    },
    {
      key: 'b',
      to: { to: '/groups/$groupId/chat', params: { groupId: 'g2' }, search: { message: 'm1' } },
      content: <span>Sign annex</span>,
      tall: true,
    },
  ],
  empty: 'Nothing here.',
  state: 'ready',
  onRetry: vi.fn(),
  ...over,
});

describe('CountCard', () => {
  it('count, caption and subline render in the left column', async () => {
    await renderWithRouter(() => <CountCard {...props()} />);
    const card = screen.getByRole('region', { name: 'Assigned to me' });
    const count = within(card).getByText('37');
    expect(count).toHaveClass('text-large', 'tabular-nums');
    expect(count.parentElement).toHaveTextContent('37assigned5 urgent');
  });

  it('shows 99+ above 99', async () => {
    await renderWithRouter(() => <CountCard {...props({ count: 140 })} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('every row is one link to its target', async () => {
    await renderWithRouter(() => <CountCard {...props()} />);
    expect(screen.getByRole('link', { name: 'Fix budget table' })).toHaveAttribute(
      'href',
      '/groups/g1/tasks/t1',
    );
    const tall = screen.getByRole('link', { name: 'Sign annex' });
    expect(tall).toHaveAttribute('href', '/groups/g2/chat?message=m1');
    expect(tall).toHaveClass('min-h-14');
  });

  it('empty rows show the empty line', async () => {
    await renderWithRouter(() => <CountCard {...props({ rows: [] })} />);
    expect(screen.getByText('Nothing here.')).toBeInTheDocument();
  });

  it('loading shows three placeholders', async () => {
    await renderWithRouter(() => <CountCard {...props({ state: 'loading' })} />);
    expect(screen.getByTestId('card-placeholder').children).toHaveLength(3);
    expect(screen.queryByText('37')).toBeNull();
  });

  it('error shows the retry line in this card only', async () => {
    const onRetry = vi.fn();
    await renderWithRouter(() => (
      <>
        <CountCard {...props({ state: 'error', onRetry })} />
        <CountCard {...props({ title: 'Mentions' })} />
      </>
    ));
    const broken = screen.getByRole('region', { name: 'Assigned to me' });
    expect(within(broken).getByRole('alert')).toHaveTextContent(t('adminHome.shell.loadError'));
    await userEvent.click(within(broken).getByRole('button', { name: t('adminHome.shell.retry') }));
    expect(onRetry).toHaveBeenCalled();
    const fine = screen.getByRole('region', { name: 'Mentions' });
    expect(within(fine).queryByRole('alert')).toBeNull();
    expect(within(fine).getByText('37')).toBeInTheDocument();
  });
});
