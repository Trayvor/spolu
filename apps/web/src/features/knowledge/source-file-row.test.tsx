import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { KnowledgeOrigin, KnowledgeSummary, Me } from '@spolu/shared';
import { mayConvert } from './auto-file-menu';
import { KnowledgeCard } from './knowledge-card';
import { KnowledgeRow } from './knowledge-row';
import { isFlatList } from './search';

const FILE = { id: 'f1', name: 'Zmluva.pdf', mime: 'application/pdf', size: 48_000 };
const item = (
  type: KnowledgeSummary['type'],
  origin: KnowledgeOrigin | null,
): KnowledgeSummary => ({
  id: 'k1',
  groupId: 'g1',
  type,
  visibility: 'public',
  title: 'Zmluva.pdf',
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
  chat: null,
  origin,
});
const ticketFile = item('ticket_file', { kind: 'ticket', id: 'tk1', number: 12, title: 'Chyba' });
const taskFile = item('task_file', { kind: 'task', id: 't1', number: null, title: 'Rozpočet' });

async function renderAt(ui: () => ReactNode) {
  const root = createRootRoute();
  const routes = ['/', '/groups/$groupId/tasks/$taskId', '/tickets/$ticketId'].map((path) =>
    createRoute({ getParentRoute: () => root, path, component: ui }),
  );
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
  return router;
}

describe('KnowledgeRow of a ticket or task file (2026-10-22)', () => {
  it('a ticket file opens the ticket and names it; the file name downloads the file', async () => {
    await renderAt(() => <KnowledgeRow item={ticketFile} onOpen={vi.fn()} />);
    expect(
      await screen.findByRole('link', { name: 'Show Zmluva.pdf in the ticket' }),
    ).toHaveAttribute('href', '/tickets/tk1');
    expect(screen.getByRole('link', { name: 'Zmluva.pdf' })).toHaveAttribute(
      'href',
      '/api/files/f1',
    );
    expect(screen.getByText('Ticket #12')).toBeInTheDocument();
  });

  it('a task file opens the task panel', async () => {
    await renderAt(() => <KnowledgeRow item={taskFile} onOpen={vi.fn()} />);
    expect(
      await screen.findByRole('link', { name: 'Show Zmluva.pdf in the task' }),
    ).toHaveAttribute('href', '/groups/g1/tasks/t1');
    expect(screen.getByText('Task: Rozpočet')).toBeInTheDocument();
  });

  it('the "…" menu saves it as a file, shows its source and opens the detail', async () => {
    const onOpen = vi.fn();
    const onConvert = vi.fn();
    const user = userEvent.setup();
    await renderAt(() => <KnowledgeRow item={taskFile} onOpen={onOpen} onConvert={onConvert} />);
    await user.click(await screen.findByRole('button', { name: 'Options for Zmluva.pdf' }));
    expect(await screen.findByRole('menuitem', { name: 'Show task' })).toHaveAttribute(
      'href',
      '/groups/g1/tasks/t1',
    );
    await user.click(screen.getByRole('menuitem', { name: 'Save as a file' }));
    expect(onConvert).toHaveBeenCalledWith('k1');
    await user.click(screen.getByRole('button', { name: 'Options for Zmluva.pdf' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Details' }));
    expect(onOpen).toHaveBeenCalledWith('k1');
  });

  it('without `onConvert` the menu has no "Save as a file"', async () => {
    const user = userEvent.setup();
    await renderAt(() => <KnowledgeCard item={ticketFile} onOpen={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Options for Zmluva.pdf' }));
    expect(await screen.findByRole('menuitem', { name: 'Show ticket' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Save as a file' })).toBeNull();
  });

  it('a hand-made file has no such menu', async () => {
    await renderAt(() => <KnowledgeRow item={item('file', null)} onOpen={vi.fn()} />);
    await screen.findByRole('button', { name: 'Open Zmluva.pdf' });
    expect(screen.queryByRole('button', { name: /Options for/ })).toBeNull();
  });
});

describe('who may save one as a file, and the flat list', () => {
  const me = (role: Me['role'], id = 'u9') => ({ id, role }) as Me;

  it('its author and admins', () => {
    expect(mayConvert(me('client', 'u1'), ticketFile)).toBe(true);
    expect(mayConvert(me('admin'), taskFile)).toBe(true);
    expect(mayConvert(me('client'), taskFile)).toBe(false);
    expect(mayConvert(null, taskFile)).toBe(false);
    expect(mayConvert(me('admin'), item('file', null))).toBe(false);
  });

  it('ticking "From ticket" or "From task" lists flat, like "From chat"', () => {
    expect(isFlatList(undefined, ['ticket_file'])).toBe(true);
    expect(isFlatList(undefined, ['task_file', 'note'])).toBe(true);
    expect(isFlatList(undefined, ['note'])).toBe(false);
  });
});
