import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { TaskDto } from '@spolu/shared';
import { TaskCard } from './task-card';

const TASK: TaskDto = {
  id: 't1',
  groupId: 'g1',
  bucketId: 'b1',
  position: 'a0',
  title: 'Fix budget table',
  urgent: false,
  dueDate: null,
  link: null,
  completedAt: null,
  createdBy: { id: 'u1', name: 'Ada' },
  assignees: [],
  fileCount: 0,
  sourceMessageId: null,
  project: null,
  event: null,
  upcomingReminders: 0,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

async function renderCard(ui: () => ReactNode) {
  const root = createRootRoute();
  const routes = ['/', '/tasks', '/groups/$groupId/tasks/$taskId'].map((path) =>
    createRoute({ getParentRoute: () => root, path, component: ui }),
  );
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
}

describe('TaskCard', () => {
  it('an unseen change: an ink dot, a bold title and a spoken "New change" (2026-10-17)', async () => {
    await renderCard(() => <TaskCard task={TASK} bucketKind="todo" today="2026-10-16" unseen />);
    await screen.findByRole('link', { name: /Fix budget table/ });
    const dot = screen.getByTestId('unseen-dot');
    expect(dot.nextElementSibling).toHaveClass('sr-only');
    expect(dot.parentElement).toHaveClass('font-bold');
  });

  it('no mark without an unseen change', async () => {
    await renderCard(() => <TaskCard task={TASK} bucketKind="todo" today="2026-10-16" />);
    await screen.findByRole('link', { name: /Fix budget table/ });
    expect(screen.queryByTestId('unseen-dot')).toBeNull();
    expect(screen.getByText('Fix budget table')).toHaveClass('font-medium');
  });

  it('links to the task panel over the group board by default, with the done circle', async () => {
    await renderCard(() => <TaskCard task={TASK} bucketKind="todo" today="2026-10-16" />);
    expect(await screen.findByRole('link', { name: /Fix budget table/ })).toHaveAttribute(
      'href',
      '/groups/g1/tasks/t1',
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('groupLine renders first and link overrides the target', async () => {
    await renderCard(() => (
      <TaskCard
        task={TASK}
        bucketKind="todo"
        today="2026-10-16"
        groupLine={<span data-testid="line">ABC s.r.o.</span>}
        link={{ to: '/tasks', search: { assignee: 'me', task: 't1' } }}
        showDone={false}
      />
    ));
    const card = await screen.findByRole('link', { name: /Fix budget table/ });
    expect(card).toHaveAttribute('href', '/tasks?assignee=me&task=t1');
    expect(card.firstElementChild).toBe(screen.getByTestId('line'));
    expect(screen.queryByRole('button')).toBeNull();
  });
});
