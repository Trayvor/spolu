import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RemindersEvents,
  type GroupPerson,
  type ReminderSetDto,
  type TaskDetailDto,
} from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { localDate, localToIso } from '@/features/reminders/reminder-times-field';
import {
  automaticReminderLine,
  defaultReminderDate,
  isAfterDeadline,
  TaskReminders,
} from './task-reminders';

const fake = vi.hoisted(() => {
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  return {
    on: (e: string, fn: (p: unknown) => void) => {
      if (!listeners.has(e)) listeners.set(e, new Set());
      listeners.get(e)!.add(fn);
    },
    off: (e: string, fn: (p: unknown) => void) => void listeners.get(e)?.delete(fn),
    fire: (e: string, p: unknown) => listeners.get(e)?.forEach((fn) => fn(p)),
    reset: () => listeners.clear(),
  };
});
vi.mock('@/lib/socket', () => ({ getSocket: () => fake }));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

const ME = { id: 'a1', name: 'Jana', email: 'j@example.com', role: 'admin', groupId: null };
const PEOPLE: GroupPerson[] = [
  { id: 'a1', name: 'Jana', isAdmin: true, isManager: true },
  { id: 'c1', name: 'Klient', isAdmin: false, isManager: false },
  { id: 'c2', name: 'Zuzana', isAdmin: false, isManager: false },
];
const HOUR = 3_600_000;
const future = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

const TASK: TaskDetailDto = {
  id: 't1',
  groupId: 'g1',
  bucketId: 'b-todo',
  position: 'a0',
  title: 'Fix the budget table',
  urgent: false,
  dueDate: null,
  completedAt: null,
  createdBy: { id: 'a1', name: 'Jana' },
  assignees: [{ id: 'c1', name: 'Klient' }],
  fileCount: 0,
  upcomingReminders: 0,
  sourceMessageId: null,
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
  description: '',
  files: [],
  sourceMessage: null,
};

const EMPTY: ReminderSetDto = { times: [], recipients: [], subscribed: false, canEdit: true };
const withTimes = (times: ReminderSetDto['times']): ReminderSetDto => ({
  times,
  recipients: [{ user: { id: 'a1', name: 'Jana' }, source: 'author' }],
  subscribed: true,
  canEdit: true,
});

let current: ReminderSetDto;
let putReply: { status: number; body: unknown } | null;
let fetchMock: ReturnType<typeof vi.fn>;
const puts = () =>
  fetchMock.mock.calls
    .filter(([u, i]) => u === '/api/tasks/t1/reminders' && (i as RequestInit)?.method === 'PUT')
    .map(([, i]) => JSON.parse((i as RequestInit).body as string));
const gets = () =>
  fetchMock.mock.calls.filter(
    ([u, i]) => u === '/api/tasks/t1/reminders' && !(i as RequestInit | undefined)?.method,
  );

beforeEach(() => {
  setLanguage('en');
  fake.reset();
  current = EMPTY;
  putReply = null;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const reply = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status });
    if (url === '/api/tasks/t1/reminders' && method === 'GET') return reply(200, current);
    if (url === '/api/tasks/t1/reminders' && method === 'PUT') {
      if (putReply) return reply(putReply.status, putReply.body);
      const body = JSON.parse(init!.body as string) as { times: { id?: string; at: string }[] };
      current = withTimes(
        body.times.map((time, i) => ({ id: time.id ?? `new${i}`, at: time.at, firedAt: null })),
      );
      return reply(200, current);
    }
    if (url === '/api/tasks/t1/reminders/subscription') return reply(204);
    if (url === '/api/groups/g1/people') return reply(200, PEOPLE);
    return reply(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderSection(task: TaskDetailDto = TASK, onTaskGone = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['session'], ME);
  render(
    <QueryClientProvider client={client}>
      <TaskReminders task={task} onTaskGone={onTaskGone} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onTaskGone };
}

describe('task reminder helpers', () => {
  it('the automatic line per deadline and urgent state', () => {
    expect(automaticReminderLine({ dueDate: '2030-01-15', urgent: false })).toBe('deadline');
    expect(automaticReminderLine({ dueDate: '2030-01-15', urgent: true })).toBe('deadlineUrgent');
    expect(automaticReminderLine({ dueDate: null, urgent: true })).toBe('urgent');
    expect(automaticReminderLine({ dueDate: null, urgent: false })).toBeNull();
    expect(
      automaticReminderLine({
        dueDate: '2030-01-15',
        urgent: false,
        completedAt: '2026-10-16T10:00:00Z',
      }),
    ).toBe('completed');
  });

  it('the after-the-deadline tag compares local dates', () => {
    expect(isAfterDeadline(localToIso('2030-01-15', '23:30'), '2030-01-15')).toBe(false);
    expect(isAfterDeadline(localToIso('2030-01-16', '00:30'), '2030-01-15')).toBe(true);
    expect(isAfterDeadline(localToIso('2030-01-16', '00:30'), null)).toBe(false);
  });

  it('the default date is the deadline when it is ahead, else today', () => {
    const now = new Date(2030, 0, 10, 12);
    expect(defaultReminderDate('2030-01-15', now)).toBe('2030-01-15');
    expect(defaultReminderDate('2030-01-05', now)).toBe('2030-01-10');
    expect(defaultReminderDate(null, now)).toBe(localDate(now));
  });
});

describe('TaskReminders', () => {
  it('shows the automatic line for a deadline, and none without deadline or urgency', async () => {
    renderSection({ ...TASK, dueDate: '2030-01-15', urgent: true });
    expect(await screen.findByText(t('reminders.task.autoDeadlineUrgent'))).toBeInTheDocument();
    expect(screen.queryByText(t('reminders.task.autoDeadline'))).toBeNull();
  });

  it('with no set: the heading, Add reminder, and Add to calendar disabled without a deadline', async () => {
    renderSection();
    expect(await screen.findByRole('button', { name: t('reminders.row.add') })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: t('reminders.task.title') })).toBeInTheDocument();
    expect(screen.queryByText(/automatically/)).toBeNull();
    expect(screen.queryByRole('link', { name: t('reminders.panel.addToCalendar') })).toBeNull();
    expect(screen.getByRole('button', { name: t('reminders.panel.addToCalendar') })).toBeDisabled();
    expect(screen.queryByRole('button', { name: t('reminders.panel.remindMe') })).toBeNull();
  });

  it('Add to calendar links to the .ics with a deadline and no upcoming time', async () => {
    renderSection({ ...TASK, dueDate: '2030-01-15' });
    expect(
      await screen.findByRole('link', { name: t('reminders.panel.addToCalendar') }),
    ).toHaveAttribute('href', '/api/tasks/t1/reminders/calendar.ics');
  });

  it('add sends times, baseTimeIds and no recipientIds', async () => {
    const existing = future(24);
    current = withTimes([
      { id: 'r1', at: existing, firedAt: null },
      { id: 'r0', at: future(-24), firedAt: future(-24) },
    ]);
    const { user } = renderSection();
    await user.click(await screen.findByRole('button', { name: t('reminders.row.add') }));
    fireEvent.change(screen.getByLabelText(t('reminders.row.date')), {
      target: { value: '2030-01-15' },
    });
    await user.click(screen.getByRole('button', { name: t('reminders.row.confirm') }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]).toEqual({
      times: [{ id: 'r1', at: existing }, { at: localToIso('2030-01-15', '09:00') }],
      baseTimeIds: ['r1'],
    });
    expect(await screen.findByText(t('reminders.task.saved'))).toBeInTheDocument();
    expect(screen.queryByLabelText(t('reminders.row.date'))).toBeNull();
  });

  it('remove sends the times without it', async () => {
    const [a, b] = [future(24), future(48)];
    current = withTimes([
      { id: 'r1', at: a, firedAt: null },
      { id: 'r2', at: b, firedAt: null },
    ]);
    const { user } = renderSection();
    const buttons = await screen.findAllByRole('button', { name: t('reminders.row.remove') });
    await user.click(buttons[0]!);
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]).toEqual({ times: [{ id: 'r2', at: b }], baseTimeIds: ['r1', 'r2'] });
  });

  it('fired times are hidden and a time after the deadline is tagged', async () => {
    current = withTimes([
      { id: 'r1', at: localToIso('2030-01-16', '09:00'), firedAt: null },
      { id: 'r2', at: localToIso('2030-01-15', '23:30'), firedAt: null },
      { id: 'r0', at: future(-24), firedAt: future(-24) },
    ]);
    renderSection({ ...TASK, dueDate: '2030-01-15' });
    expect(await screen.findAllByText(t('reminders.task.afterDeadline'))).toHaveLength(1);
    expect(screen.queryByText(t('reminders.panel.sent'))).toBeNull();
  });

  it('Add assignees adds the missing assignees and Done sends recipientIds', async () => {
    const at = future(24);
    current = withTimes([{ id: 'r1', at, firedAt: null }]);
    const { user } = renderSection();
    await user.click(await screen.findByRole('button', { name: t('reminders.task.change') }));
    await user.click(await screen.findByRole('button', { name: t('reminders.task.addAssignees') }));
    await user.click(screen.getByRole('button', { name: t('reminders.task.done') }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]).toEqual({
      times: [{ id: 'r1', at }],
      baseTimeIds: ['r1'],
      recipientIds: ['c1'],
    });
  });

  it('Remind me toggles the subscription', async () => {
    current = {
      ...withTimes([{ id: 'r1', at: future(24), firedAt: null }]),
      recipients: [{ user: { id: 'c1', name: 'Klient' }, source: 'author' }],
      subscribed: false,
    };
    const { user } = renderSection();
    await user.click(await screen.findByRole('button', { name: t('reminders.panel.remindMe') }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, i]) =>
            u === '/api/tasks/t1/reminders/subscription' && (i as RequestInit).method === 'POST',
        ),
      ).toBe(true),
    );
  });

  it('reminder_in_past keeps the row with the message', async () => {
    putReply = { status: 400, body: { error: 'reminder_in_past' } };
    const { user } = renderSection();
    await user.click(await screen.findByRole('button', { name: t('reminders.row.add') }));
    await user.click(screen.getByRole('button', { name: t('reminders.row.confirm') }));
    expect(await screen.findByText(t('reminders.task.inPast'))).toBeInTheDocument();
    expect(screen.getByLabelText(t('reminders.row.date'))).toBeInTheDocument();
  });

  it('adding an instant already in the list shows the duplicate message and sends nothing', async () => {
    const at = localToIso('2030-01-15', '09:00');
    current = withTimes([{ id: 'r1', at, firedAt: null }]);
    const { user } = renderSection();
    await user.click(await screen.findByRole('button', { name: t('reminders.row.add') }));
    fireEvent.change(screen.getByLabelText(t('reminders.row.date')), {
      target: { value: '2030-01-15' },
    });
    await user.click(screen.getByRole('button', { name: t('reminders.row.confirm') }));
    expect(await screen.findByText(t('reminders.fields.errors.duplicate'))).toBeInTheDocument();
    expect(puts()).toHaveLength(0);
  });

  it('another error shows saveFailed', async () => {
    putReply = { status: 500, body: { error: 'internal' } };
    const { user } = renderSection();
    await user.click(await screen.findByRole('button', { name: t('reminders.row.add') }));
    await user.click(screen.getByRole('button', { name: t('reminders.row.confirm') }));
    expect(await screen.findByText(t('reminders.task.saveFailed'))).toBeInTheDocument();
  });

  it('a 404 calls onTaskGone', async () => {
    putReply = { status: 404, body: { error: 'not_found' } };
    const { user, onTaskGone } = renderSection();
    await user.click(await screen.findByRole('button', { name: t('reminders.row.add') }));
    await user.click(screen.getByRole('button', { name: t('reminders.row.confirm') }));
    await waitFor(() => expect(onTaskGone).toHaveBeenCalled());
  });

  it('a reminders:task event refetches', async () => {
    renderSection();
    await screen.findByRole('button', { name: t('reminders.row.add') });
    expect(gets()).toHaveLength(1);
    current = withTimes([{ id: 'r9', at: future(5), firedAt: null }]);
    act(() =>
      fake.fire(RemindersEvents.task, { groupId: 'g1', taskId: 'other', upcomingReminders: 1 }),
    );
    act(() =>
      fake.fire(RemindersEvents.task, { groupId: 'g1', taskId: 't1', upcomingReminders: 1 }),
    );
    await waitFor(() => expect(gets()).toHaveLength(2));
    expect(
      await screen.findByRole('button', { name: t('reminders.row.remove') }),
    ).toBeInTheDocument();
  });
});
