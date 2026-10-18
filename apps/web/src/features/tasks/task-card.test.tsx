import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { TaskDto } from '@spolu/shared';
import { i18n } from '@/i18n';
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
  knowledgeCount: 0,
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
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await router.load();
}

describe('TaskCard', () => {
  it('an unseen change: a bold title and a yellow dot marker beside the link (2026-10-18)', async () => {
    await renderCard(() => (
      <TaskCard task={TASK} bucketKind="todo" today="2026-10-16" unseen="change" />
    ));
    const link = await screen.findByRole('link', { name: /Fix budget table/ });
    expect(screen.getByText('Fix budget table')).toHaveClass('font-bold');
    const marker = screen.getByRole('button', { name: i18n.t('unseen.mark.change') });
    expect(link).not.toContainElement(marker);
    expect(within(marker).getByTestId('unseen-dot')).toBeInTheDocument();
    expect(within(marker).queryByTestId('unseen-ring')).toBeNull();
  });

  it('an unseen chat message: a yellow ring marker, "New message"', async () => {
    await renderCard(() => (
      <TaskCard task={TASK} bucketKind="todo" today="2026-10-16" unseen="message" />
    ));
    const marker = await screen.findByRole('button', { name: i18n.t('unseen.mark.message') });
    expect(within(marker).getByTestId('unseen-ring')).toBeInTheDocument();
  });

  it('no mark without an unseen change', async () => {
    await renderCard(() => <TaskCard task={TASK} bucketKind="todo" today="2026-10-16" />);
    await screen.findByRole('link', { name: /Fix budget table/ });
    expect(screen.queryByTestId('unseen-dot')).toBeNull();
    expect(screen.queryByRole('button', { name: i18n.t('unseen.mark.change') })).toBeNull();
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

  it('shows a book icon with the linked knowledge count, spoken and as a tooltip', async () => {
    await renderCard(() => (
      <TaskCard task={{ ...TASK, knowledgeCount: 3 }} bucketKind="todo" today="2026-10-16" />
    ));
    const card = await screen.findByRole('link', { name: /Fix budget table/ });
    const mark = screen.getByTitle('3 knowledge items');
    expect(mark).toHaveTextContent('3');
    expect(card).toContainElement(mark);
    expect(card).toHaveAccessibleName(/3 knowledge items/);
  });

  it('no knowledge mark without linked items', async () => {
    await renderCard(() => <TaskCard task={TASK} bucketKind="todo" today="2026-10-16" />);
    await screen.findByRole('link', { name: /Fix budget table/ });
    expect(screen.queryByTitle(/knowledge item/)).toBeNull();
  });
});
