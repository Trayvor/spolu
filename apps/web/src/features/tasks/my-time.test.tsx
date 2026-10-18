import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, queryOptions } from '@tanstack/react-query';
import type { SessionUser, TaskTimeDto } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { seesTime, TaskMyTime } from './my-time';
import { clearTimeAsks, useTimeAsk } from './time-queue';

const api = vi.hoisted(() => ({ task: null as unknown as TaskTimeDto }));
vi.mock('./time-api', () => ({
  taskTimeQuery: (id: string) =>
    queryOptions({ queryKey: ['tasks', 'time', id], queryFn: async () => api.task }),
  ticketTimeQuery: (id: string) =>
    queryOptions({ queryKey: ['tickets', 'time', id], queryFn: async () => api.task }),
}));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
const user = (role: SessionUser['role'], finance = false): SessionUser => ({
  id: 'me',
  email: 'me@example.com',
  name: 'Me',
  role,
  finance,
});

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TaskMyTime task={{ id: 't1', groupId: 'g1', title: 'Budget' }} />
    </QueryClientProvider>,
  );
}

describe('My time', () => {
  beforeEach(() => setLanguage('en'));
  afterEach(() => clearTimeAsks());

  it('shows only to admin assignees and finance admins', () => {
    expect(seesTime(user('admin'), ['me'])).toBe(true);
    expect(seesTime(user('admin'), ['x'])).toBe(false);
    expect(seesTime(user('admin', true), ['x'])).toBe(true);
    expect(seesTime(user('client'), ['me'])).toBe(false);
    expect(seesTime(null, ['me'])).toBe(false);
  });

  it('"Not filled" with "Fill in", which opens the dialog', async () => {
    api.task = { mine: { minutes: null, requested: true } };
    show();
    expect(await screen.findByText(t('tasks.time.notFilled'))).toBeInTheDocument();
    const queue = renderHook(() => useTimeAsk());
    await userEvent.click(screen.getByRole('button', { name: t('tasks.time.fill') }));
    expect(queue.result.current).toEqual({
      kind: 'task',
      id: 't1',
      groupId: 'g1',
      title: 'Budget',
    });
  });

  it('filled time with "Edit"', async () => {
    api.task = { mine: { minutes: 90, requested: false } };
    show();
    expect(await screen.findByText('1 h 30 min')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('tasks.time.edit') })).toBeInTheDocument();
  });

  it("a finance admin sees every admin's time, without a My time of their own", async () => {
    api.task = {
      mine: null,
      assignees: [
        { userId: 'a', name: 'Eva', minutes: 90, requested: false },
        { userId: 'b', name: 'Ján', minutes: null, requested: true },
      ],
    };
    show();
    expect(
      await screen.findByText(
        t('tasks.time.everyone', { list: 'Eva 1 h 30 min, Ján Not recorded' }),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
