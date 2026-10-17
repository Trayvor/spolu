import { render, screen, waitFor } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import type { MessageDto } from '@spolu/shared';
import '@/i18n';
import { WorkCards } from './work-cards';

async function renderCards(
  work: Pick<MessageDto, 'attachedTasks' | 'attachedTickets'>,
  expectContent = true,
) {
  const message = { ...work } as MessageDto;
  const root = createRootRoute({ component: () => <WorkCards message={message} groupId="g1" /> });
  const task = createRoute({ getParentRoute: () => root, path: '/groups/$groupId/tasks/$taskId' });
  const ticket = createRoute({ getParentRoute: () => root, path: '/tickets/$ticketId' });
  const router = createRouter({
    routeTree: root.addChildren([task, ticket]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const view = render(<RouterProvider router={router} />);
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
});
