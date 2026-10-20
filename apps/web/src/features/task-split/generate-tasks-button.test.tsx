import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TaskDetailDto } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { createTasksFromText, proposeTextTasks } from './split-api';
import { GenerateTasksButton } from './generate-tasks-button';

vi.mock('./split-api', () => ({
  proposeTextTasks: vi.fn(),
  createTasksFromText: vi.fn(),
}));

const propose = vi.mocked(proposeTextTasks);
const create = vi.mocked(createTasksFromText);

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);
const group = (id: string, name: string, kind = 'client') => ({
  id,
  name,
  kind,
  hasLogo: false,
  memberCount: 1,
  updatedAt: '2026-10-01T00:00:00Z',
  managers: [],
  managedByMe: true,
});

function setup(taskSplit: boolean, props: { groupId: string | null; pickGroup?: boolean }) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width: 641px'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url);
      if (path.endsWith('/ai/status')) {
        return new Response(JSON.stringify({ taskSplit }), { status: 200 });
      }
      if (path.includes('/groups') && !path.includes('/people') && !path.includes('/board')) {
        return new Response(
          JSON.stringify([group('g1', 'Acme'), group('g2', 'Beta'), group('ga', 'Admin', 'admin')]),
          { status: 200 },
        );
      }
      return new Response('[]', { status: 200 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <GenerateTasksButton {...props} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const PROPOSAL = {
  title: 'Call the bank',
  description: '',
  assigneeIds: [],
  dueDate: null,
  urgent: false,
  messageFileIds: [],
  link: null,
};

describe('GenerateTasksButton', () => {
  beforeEach(async () => {
    await setLanguage('en');
    propose.mockReset();
    create.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is hidden while the AI is off', async () => {
    setup(false, { groupId: 'g1' });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('on a group board: text, the same review, then the cards are created there', async () => {
    propose.mockResolvedValue({ tasks: [PROPOSAL], files: [] });
    create.mockResolvedValue([{ id: 't1' } as TaskDetailDto]);
    const user = setup(true, { groupId: 'g1' });

    await user.click(await screen.findByRole('button', { name: t('taskSplit.fromText.button') }));
    const generate = await screen.findByRole('button', { name: t('taskSplit.fromText.generate') });
    expect(generate).toBeDisabled();
    expect(screen.queryByLabelText(t('taskSplit.fromText.client'))).toBeNull();
    await user.type(screen.getByLabelText(t('taskSplit.fromText.text')), '- Call the bank');
    await user.click(generate);

    expect(propose).toHaveBeenCalledWith('g1', '- Call the bank');
    await user.click(await screen.findByRole('button', { name: t('taskSplit.approveAll') }));
    await user.click(screen.getByRole('button', { name: 'Create 1 task' }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('g1', {
        tasks: [expect.objectContaining({ title: 'Call the bank', messageFileIds: [] })],
        bucketId: undefined,
      }),
    );
    expect(await screen.findByText(t('taskSplit.created', { count: 1 }))).toBeInTheDocument();
  });

  it('on the global board: the client is chosen first, or preselected', async () => {
    propose.mockReturnValue(new Promise(() => undefined));
    const user = setup(true, { groupId: 'g2', pickGroup: true });

    await user.click(await screen.findByRole('button', { name: t('taskSplit.fromText.button') }));
    const select = await screen.findByLabelText(t('taskSplit.fromText.client'));
    // Only client groups are offered, the preselected one is chosen.
    await waitFor(() => expect(select).toHaveValue('g2'));
    expect(screen.queryByRole('option', { name: 'Admin' })).toBeNull();
    await user.type(screen.getByLabelText(t('taskSplit.fromText.text')), 'Do things');
    await user.selectOptions(select, 'g1');
    await user.click(screen.getByRole('button', { name: t('taskSplit.fromText.generate') }));
    expect(propose).toHaveBeenCalledWith('g1', 'Do things');
  });

  it('on the global board without a preselected client Generate waits for a choice', async () => {
    const user = setup(true, { groupId: null, pickGroup: true });
    await user.click(await screen.findByRole('button', { name: t('taskSplit.fromText.button') }));
    await user.type(await screen.findByLabelText(t('taskSplit.fromText.text')), 'Do things');
    expect(screen.getByRole('button', { name: t('taskSplit.fromText.generate') })).toBeDisabled();
    await user.selectOptions(await screen.findByLabelText(t('taskSplit.fromText.client')), 'g1');
    expect(screen.getByRole('button', { name: t('taskSplit.fromText.generate') })).toBeEnabled();
  });
});
