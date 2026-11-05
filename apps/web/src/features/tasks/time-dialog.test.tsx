import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, queryOptions } from '@tanstack/react-query';
import type { TaskTimeDto, TicketTimeDto } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { ApiError } from '@/lib/api';
import { TimeDialog } from './time-dialog';

const api = vi.hoisted(() => ({
  task: { mine: { minutes: null, requested: true } } as TaskTimeDto,
  ticket: {
    mine: { minutes: null, requested: true, coveredByTasks: false },
    linkedTasks: [],
    linkedTasksLogged: false,
  } as TicketTimeDto,
  saveTask: vi.fn(),
  saveTicket: vi.fn(),
  keepTicket: vi.fn(),
}));
vi.mock('./time-api', () => ({
  taskTimeQuery: (id: string) =>
    queryOptions({ queryKey: ['tasks', 'time', id], queryFn: async () => api.task }),
  ticketTimeQuery: (id: string) =>
    queryOptions({ queryKey: ['tickets', 'time', id], queryFn: async () => api.ticket }),
  saveMyTaskTime: (_qc: unknown, id: string, minutes: number) => api.saveTask(id, minutes),
  saveMyTicketTime: (_qc: unknown, id: string, body: unknown) => api.saveTicket(id, body),
  keepMyTicketTime: (_qc: unknown, id: string) => api.keepTicket(id),
}));
vi.mock('@/features/groups/api', () => ({
  groupQuery: (id: string) =>
    queryOptions({ queryKey: ['groups', id], queryFn: async () => ({ id, name: 'Firma' }) }),
}));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

function open(kind: 'task' | 'ticket' = 'task') {
  const onDone = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TimeDialog
        ask={
          kind === 'task'
            ? { kind, id: 't1', groupId: 'g1', title: 'Budget' }
            : { kind, id: 'k1', groupId: 'g1', title: '#12 Login fails' }
        }
        onDone={onDone}
      />
    </QueryClientProvider>,
  );
  return onDone;
}

describe('the time dialog', () => {
  beforeEach(async () => {
    await setLanguage('en');
    api.saveTask.mockResolvedValue({});
    api.saveTicket.mockResolvedValue({});
    api.keepTicket.mockResolvedValue({});
  });
  afterEach(() => vi.clearAllMocks());

  it('reads 1:30 and saves 90 minutes', async () => {
    const onDone = open();
    expect(screen.getByRole('heading', { name: t('tasks.time.title') })).toBeInTheDocument();
    expect(await screen.findByText('Budget · Firma')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(t('tasks.time.duration')), '1:30');
    expect(screen.getByText('That is 1 h 30 min')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: t('tasks.time.save') }));
    expect(api.saveTask).toHaveBeenCalledWith('t1', 90);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('a chip fills the field; "No time" saves 0', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: '2 h' }));
    expect(screen.getByLabelText(t('tasks.time.duration'))).toHaveValue('2:00');
    expect(screen.getByRole('button', { name: '2 h' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: t('tasks.time.none') }));
    await userEvent.click(screen.getByRole('button', { name: t('tasks.time.save') }));
    expect(api.saveTask).toHaveBeenCalledWith('t1', 0);
  });

  it('warns above 12 h and refuses what it cannot read or above 100 h', async () => {
    open();
    const field = screen.getByLabelText(t('tasks.time.duration'));
    await userEvent.type(field, '13h');
    expect(screen.getByText(t('tasks.time.long'))).toBeInTheDocument();
    await userEvent.clear(field);
    await userEvent.type(field, '101h');
    await userEvent.click(screen.getByRole('button', { name: t('tasks.time.save') }));
    expect(screen.getByRole('alert')).toHaveTextContent(t('tasks.time.invalid'));
    expect(api.saveTask).not.toHaveBeenCalled();
  });

  it('Later closes without saving', async () => {
    const onDone = open();
    await userEvent.click(screen.getByRole('button', { name: t('tasks.time.later') }));
    expect(onDone).toHaveBeenCalled();
    expect(api.saveTask).not.toHaveBeenCalled();
  });

  it('an edit starts from the saved minutes', async () => {
    api.task = { mine: { minutes: 45, requested: false } };
    open();
    await waitFor(() =>
      expect(screen.getByLabelText(t('tasks.time.duration'))).toHaveValue('0:45'),
    );
    api.task = { mine: { minutes: null, requested: true } };
  });

  it('a ticket with logged linked tasks offers (b) "covered by the tasks"', async () => {
    api.ticket = {
      mine: { minutes: null, requested: true, coveredByTasks: false },
      linkedTasks: [{ taskId: 'x', title: 'Fix login', done: true, mine: 60 }],
      linkedTasksLogged: true,
    };
    open('ticket');
    expect(
      screen.getByRole('heading', {
        name: t('tasks.time.ticketTitle', { ticket: '#12 Login fails' }),
      }),
    ).toBeInTheDocument();
    await userEvent.click(await screen.findByLabelText(new RegExp(t('tasks.time.optionCovered'))));
    expect(screen.getByLabelText(t('tasks.time.duration'))).toBeDisabled();
    expect(screen.getByText('Fix login')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: t('tasks.time.save') }));
    expect(api.saveTicket).toHaveBeenCalledWith('k1', { coveredByTasks: true });
  });

  it('a ticket without logged linked tasks shows only the duration', async () => {
    api.ticket = {
      mine: { minutes: null, requested: true, coveredByTasks: false },
      linkedTasks: [],
      linkedTasksLogged: false,
    };
    open('ticket');
    await userEvent.type(screen.getByLabelText(t('tasks.time.duration')), '30m');
    expect(screen.queryByLabelText(new RegExp(t('tasks.time.optionCovered')))).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: t('tasks.time.save') }));
    expect(api.saveTicket).toHaveBeenCalledWith('k1', { minutes: 30 });
  });

  describe('a ticket with saved minutes (design 5.4)', () => {
    const keep = () => screen.findByRole('button', { name: t('tasks.time.keep') });
    const noKeep = () =>
      expect(screen.queryByRole('button', { name: t('tasks.time.keep') })).toBeNull();
    const reset = () => {
      api.ticket = {
        mine: { minutes: null, requested: true, coveredByTasks: false },
        linkedTasks: [],
        linkedTasksLogged: false,
      };
    };
    beforeEach(() => {
      api.ticket = {
        mine: { minutes: 90, requested: false, coveredByTasks: false },
        linkedTasks: [],
        linkedTasksLogged: false,
      };
    });
    afterEach(reset);

    it('prefills the minutes, and "No change" sends keep and closes', async () => {
      const onDone = open('ticket');
      await userEvent.click(await keep());
      expect(screen.getByLabelText(t('tasks.time.duration'))).toHaveValue('1:30');
      expect(api.keepTicket).toHaveBeenCalledWith('k1');
      expect(api.saveTicket).not.toHaveBeenCalled();
      await waitFor(() => expect(onDone).toHaveBeenCalled());
    });

    it('"No change" sends one request on a double click', async () => {
      open('ticket');
      await userEvent.dblClick(await keep());
      expect(api.keepTicket).toHaveBeenCalledTimes(1);
    });

    it('a failed keep stays open with the error', async () => {
      api.keepTicket.mockRejectedValue(new Error('boom'));
      const onDone = open('ticket');
      await userEvent.click(await keep());
      expect(await screen.findByRole('alert')).toHaveTextContent(t('tasks.time.saveFailed'));
      expect(onDone).not.toHaveBeenCalled();
      expect(await keep()).toBeEnabled();
    });

    it('a keep on a ticket out of reach closes: nothing left to ask', async () => {
      api.keepTicket.mockRejectedValue(new ApiError('gone', 404, null));
      const onDone = open('ticket');
      await userEvent.click(await keep());
      await waitFor(() => expect(onDone).toHaveBeenCalled());
    });

    it('with no minutes the dialog is the ordinary one', async () => {
      reset();
      open('ticket');
      await screen.findByText('Firma');
      noKeep();
    });

    it('a task has no "No change"', async () => {
      api.task = { mine: { minutes: 45, requested: false } };
      open();
      await waitFor(() =>
        expect(screen.getByLabelText(t('tasks.time.duration'))).toHaveValue('0:45'),
      );
      noKeep();
      api.task = { mine: { minutes: null, requested: true } };
    });
  });
});
