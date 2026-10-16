import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { KnowledgeChatSource, KnowledgeSummary } from '@spolu/shared';
import { KnowledgeRow } from './knowledge-row';

const FILE = { id: 'f1', name: 'Rozpočet.pdf', mime: 'application/pdf', size: 48_000 };
const chat = (over: Partial<KnowledgeChatSource> = {}): KnowledgeChatSource => ({
  channelId: 'c1',
  messageId: 'm1',
  parentId: null,
  kind: 'group',
  taskId: null,
  taskTitle: null,
  ticketId: null,
  ticketNumber: null,
  ...over,
});
const item = (source: KnowledgeChatSource): KnowledgeSummary => ({
  id: 'k1',
  groupId: 'g1',
  type: 'chat_file',
  visibility: 'public',
  title: 'Rozpočet.pdf',
  excerpt: '',
  url: null,
  file: { ...FILE, width: null, height: null, hasPreview: false },
  fileCount: 1,
  nextReminderAt: null,
  upcomingCount: 0,
  lastReminderAt: null,
  createdBy: { id: 'u1', name: 'Jana Nováková' },
  createdAt: '2026-10-14T10:00:00.000Z',
  updatedAt: '2026-10-14T10:00:00.000Z',
  folderId: null,
  folderPath: [],
  chat: source,
});

async function renderRow(ui: () => ReactNode) {
  const root = createRootRoute();
  const routes = [
    '/',
    '/groups/$groupId/chat',
    '/groups/$groupId/tasks/$taskId',
    '/tickets/$ticketId',
  ].map((path) => createRoute({ getParentRoute: () => root, path, component: ui }));
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
}

describe('KnowledgeRow of a chat file', () => {
  it('opens the group chat at the message; the file name downloads the file', async () => {
    const onOpen = vi.fn();
    await renderRow(() => <KnowledgeRow item={item(chat())} onOpen={onOpen} />);
    expect(
      await screen.findByRole('link', { name: 'Show Rozpočet.pdf in the chat' }),
    ).toHaveAttribute('href', '/groups/g1/chat?message=m1&c=c1');
    expect(screen.getByRole('link', { name: 'Rozpočet.pdf' })).toHaveAttribute(
      'href',
      '/api/files/f1',
    );
    expect(screen.getByText('Group chat')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open/ })).not.toBeInTheDocument();
  });

  it('a task chat opens the task panel, a reply its thread', async () => {
    await renderRow(() => (
      <KnowledgeRow
        item={item(chat({ kind: 'task', taskId: 't1', taskTitle: 'Plán', parentId: 'r1' }))}
        onOpen={vi.fn()}
      />
    ));
    const link = await screen.findByRole('link', { name: /in the chat/ });
    expect(link.getAttribute('href')).toBe(
      '/groups/g1/tasks/t1?tab=chat&thread=r1&message=m1&c=c1',
    );
    expect(screen.getByText('Task: Plán')).toBeInTheDocument();
  });

  it('a ticket chat opens the ticket page', async () => {
    await renderRow(() => (
      <KnowledgeRow
        item={item(chat({ kind: 'ticket', ticketId: 'tk1', ticketNumber: 12 }))}
        onOpen={vi.fn()}
      />
    ));
    expect(await screen.findByRole('link', { name: /in the chat/ })).toHaveAttribute(
      'href',
      '/tickets/tk1?message=m1&c=c1',
    );
    expect(screen.getByText('Ticket #12')).toBeInTheDocument();
  });
});
