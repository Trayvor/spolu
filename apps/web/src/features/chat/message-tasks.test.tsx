import { render, screen, waitFor } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import type { MessageTaskLink } from '@spolu/shared';
import '@/i18n';
import { MessageTasks } from './message-tasks';

async function renderTasks(tasks: MessageTaskLink[]) {
  const root = createRootRoute({ component: () => <MessageTasks groupId="g1" tasks={tasks} /> });
  const task = createRoute({ getParentRoute: () => root, path: '/groups/$groupId/tasks/$taskId' });
  const router = createRouter({
    routeTree: root.addChildren([task]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const view = render(<RouterProvider router={router} />);
  await waitFor(() => expect(view.container.firstChild).not.toBeNull());
  return view;
}

describe('MessageTasks', () => {
  it('lists the tasks with links and strikes completed ones', async () => {
    await renderTasks([
      { id: 't1', title: 'Report', completed: false },
      { id: 't2', title: 'Bank', completed: true },
    ]);
    expect(screen.getByText('Turned into tasks:')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Report' })).toHaveAttribute(
      'href',
      '/groups/g1/tasks/t1',
    );
    expect(screen.getByText('Bank')).toHaveClass('line-through');
    expect(screen.getByText('Report')).not.toHaveClass('line-through');
    expect(screen.getByRole('link', { name: /Bank/ })).toHaveTextContent('Completed');
  });

  it('renders nothing without tasks', async () => {
    const root = createRootRoute({ component: () => <MessageTasks groupId="g1" tasks={[]} /> });
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    const { container } = render(<RouterProvider router={router} />);
    await waitFor(() => expect(router.state.status).toBe('idle'));
    expect(container).toBeEmptyDOMElement();
  });
});
