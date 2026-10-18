import { render, screen, waitFor } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { GroupSummary, MessageDto } from '@spolu/shared';
import '@/i18n';
import { apiGet } from '@/lib/api';
import { WorkCards } from './work-cards';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiGet: vi.fn(),
}));

const summary = (id: string, name: string, extra: Partial<GroupSummary> = {}): GroupSummary => ({
  id,
  name,
  kind: 'client',
  hasLogo: false,
  memberCount: 1,
  updatedAt: '2026-10-17T10:00:00.000Z',
  managers: [],
  managedByMe: false,
  ...extra,
});

async function renderCards(
  work: Pick<MessageDto, 'attachedTasks' | 'attachedTickets'>,
  expectContent = true,
  groupId = 'g1',
) {
  const message = { ...work } as MessageDto;
  const root = createRootRoute({
    component: () => <WorkCards message={message} groupId={groupId} />,
  });
  const task = createRoute({ getParentRoute: () => root, path: '/groups/$groupId/tasks/$taskId' });
  const ticket = createRoute({ getParentRoute: () => root, path: '/tickets/$ticketId' });
  const router = createRouter({
    routeTree: root.addChildren([task, ticket]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  if (expectContent) await waitFor(() => expect(view.container.firstChild).not.toBeNull());
  else await new Promise((resolve) => setTimeout(resolve, 50));
  return view;
}

describe('WorkCards', () => {
  it('shows a task card with bucket, assignees and a link to the task panel', async () => {
    await renderCards({
      attachedTickets: [],
      attachedTasks: [
        {
          id: 't1',
          available: true,
          groupId: 'g1',
          title: 'Report',
          completed: false,
          bucketKind: 'egrant_review',
          bucketName: null,
          assignees: [{ id: 'u1', name: 'Anna Nová' }],
          dueDate: '2000-01-02',
          urgent: true,
        },
        {
          id: 't2',
          available: true,
          groupId: 'g1',
          title: 'Bank',
          completed: true,
          bucketKind: 'custom',
          bucketName: 'Waiting',
          assignees: [],
          dueDate: null,
          urgent: false,
        },
        { id: 't3', available: false },
      ],
    });
    const open = screen.getByRole('link', { name: /Report/ });
    expect(open).toHaveAttribute('href', '/groups/g1/tasks/t1');
    expect(open).toHaveTextContent('eGrant review');
    expect(open).toHaveTextContent('Anna Nová');
    expect(open).toHaveTextContent('Overdue');
    expect(open).toHaveTextContent('Urgent');
    const done = screen.getByRole('link', { name: /Bank/ });
    expect(done).toHaveTextContent('Waiting');
    expect(screen.getByText('Bank')).toHaveClass('line-through');
    expect(done).toHaveTextContent('Completed');
    expect(screen.getByText('Task unavailable')).toBeInTheDocument();
  });

  it('shows a ticket card with number, subject and status, and "unavailable" for a gone one', async () => {
    await renderCards({
      attachedTasks: [],
      attachedTickets: [
        {
          id: 'k1',
          available: true,
          groupId: 'g1',
          number: 123,
          subject: 'Login fails',
          status: 'in_progress',
          assignees: [],
        },
        { id: 'k2', available: false },
      ],
    });
    const card = screen.getByRole('link', { name: /Login fails/ });
    expect(card).toHaveAttribute('href', '/tickets/k1');
    expect(card).toHaveTextContent('#123');
    expect(card).toHaveTextContent('In progress');
    expect(screen.getByText('Ticket unavailable')).toBeInTheDocument();
  });

  it('renders nothing for a message without tasks or tickets', async () => {
    const view = await renderCards({ attachedTasks: [], attachedTickets: [] }, false);
    expect(view.container.querySelector('a')).toBeNull();
  });

  it('in the admin group a card of another group names its client and opens in that group', async () => {
    vi.mocked(apiGet).mockResolvedValue([
      summary('admin', 'eGrant tím', { kind: 'admin' }),
      summary('x', 'Obec Lúčky', { managedByMe: true }),
      summary('y', 'Mesto Nitra'),
    ] as never);
    await renderCards(
      {
        attachedTasks: [
          {
            id: 't1',
            available: true,
            groupId: 'x',
            title: 'Report',
            completed: false,
            bucketKind: 'todo',
            bucketName: null,
            assignees: [],
            dueDate: null,
            urgent: false,
          },
        ],
        attachedTickets: [
          {
            id: 'k1',
            available: true,
            groupId: 'y',
            number: 5,
            subject: 'Login fails',
            status: 'new',
            assignees: [],
          },
          {
            id: 'k2',
            available: true,
            groupId: null,
            number: 6,
            subject: 'Orphan',
            status: 'new',
            assignees: [],
          },
        ],
      },
      true,
      'admin',
    );
    const task = screen.getByRole('link', { name: /Report/ });
    expect(task).toHaveAttribute('href', '/groups/x/tasks/t1');
    await waitFor(() => expect(task).toHaveTextContent('Obec Lúčky'));
    // The viewer manages X: the manager dot and its words for screen readers.
    expect(task.querySelector('[data-managed-dot]')).not.toBeNull();
    expect(task).toHaveTextContent('Your client');
    const ticket = screen.getByRole('link', { name: /Login fails/ });
    expect(ticket).toHaveTextContent('Mesto Nitra');
    expect(ticket.querySelector('[data-managed-dot]')).toBeNull();
    expect(screen.getByRole('link', { name: /Orphan/ })).toHaveTextContent('Without client');
  });
});
