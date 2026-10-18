import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { i18n, setLanguage } from '@/i18n';
import { apiGet } from '@/lib/api';
import AttachPicker from './index';
import { NOTHING_PICKED, toggled } from './picked';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiGet: vi.fn(),
}));

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

const task = (id: string, title: string) => ({
  id,
  available: true,
  groupId: 'g1',
  title,
  completed: false,
  bucketKind: 'todo',
  bucketName: null,
  assignees: [],
  dueDate: null,
  urgent: false,
});
const ticket = (id: string, number: number, subject: string) => ({
  id,
  number,
  groupId: 'g1',
  groupName: 'Firma',
  status: 'new',
  area: null,
  subject,
  dueDate: null,
  createdAt: '2026-10-17T10:00:00.000Z',
  assignees: [],
  requesterName: null,
  excerpt: null,
});

const summary = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  kind: 'client',
  hasLogo: false,
  memberCount: 1,
  updatedAt: '2026-10-17T10:00:00.000Z',
  managers: [],
  managedByMe: false,
  ...extra,
});
/** The admin's `/groups`: the admin group, one managed client and one other. */
const GROUPS = [
  summary('admin', 'eGrant tím', { kind: 'admin' }),
  summary('g1', 'Obec Lúčky', { managedByMe: true }),
  summary('g2', 'Mesto Nitra'),
];

function answer(path: string) {
  if (path === '/groups') return GROUPS;
  if (path.includes('/tasks/search')) {
    return { items: [task('t1', 'Fix the budget'), task('t2', 'Send invoice')], next: null };
  }
  if (path.includes('/tickets')) {
    return { items: [ticket('k1', 7, 'Login fails')], nextCursor: null };
  }
  return {
    items: [
      { id: 'n1', type: 'note', title: 'Procedure', folderPath: [], updatedAt: '2026-10-17' },
    ],
    nextCursor: null,
  };
}

function open(onDone = vi.fn(), groupId = 'g1') {
  const view = render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AttachPicker
        groupId={groupId}
        picked={NOTHING_PICKED}
        onDone={onDone}
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onDone, view };
}

beforeEach(() => {
  setLanguage('en');
  localStorage.clear();
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiGet).mockImplementation((path: string) => Promise.resolve(answer(path)) as never);
});

describe('toggled', () => {
  it('adds, removes and stops at the limit', () => {
    const a = { id: 'a' };
    expect(toggled([], a, 2)).toEqual([a]);
    expect(toggled([a], a, 2)).toEqual([]);
    expect(toggled([a, { id: 'b' }], { id: 'c' }, 2)).toHaveLength(2);
  });
});

describe('attachment picker', () => {
  it('has the three tabs and opens on Knowledge', async () => {
    open();
    expect(await screen.findByText('Procedure')).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((x) => x.textContent)).toEqual(['Knowledge', 'Tasks', 'Tickets']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('picks across tabs, shows chips and attaches everything', async () => {
    const { user, onDone } = open();
    await user.click(await screen.findByRole('checkbox', { name: /Procedure/ }));
    await user.click(screen.getByRole('tab', { name: t('chat.work.tabs.tasks') }));
    await user.click(await screen.findByRole('checkbox', { name: /Fix the budget/ }));
    await user.click(screen.getByRole('tab', { name: new RegExp(t('chat.work.tabs.tickets')) }));
    await user.click(await screen.findByRole('checkbox', { name: /Login fails/ }));

    const chips = screen.getByRole('list', { name: t('chat.work.attached') });
    expect(chips).toHaveTextContent('Procedure');
    expect(chips).toHaveTextContent('Fix the budget');
    expect(chips).toHaveTextContent('7 Login fails');

    await user.click(
      screen.getByRole('button', { name: t('chat.knowledge.attachCount', { count: 3 }) }),
    );
    const picked = onDone.mock.calls[0]![0];
    expect(picked.knowledge.map((k: { id: string }) => k.id)).toEqual(['n1']);
    expect(picked.tasks.map((k: { id: string }) => k.id)).toEqual(['t1']);
    expect(picked.tickets).toMatchObject([{ id: 'k1', number: 7, subject: 'Login fails' }]);
  });

  it('a chip removes its item from any tab', async () => {
    const { user } = open();
    await user.click(screen.getByRole('tab', { name: t('chat.work.tabs.tasks') }));
    await user.click(await screen.findByRole('checkbox', { name: /Send invoice/ }));
    await user.click(
      screen.getByRole('button', { name: t('chat.knowledge.remove', { title: 'Send invoice' }) }),
    );
    expect(screen.queryByRole('list', { name: t('chat.work.attached') })).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Send invoice/ })).not.toBeChecked();
  });

  it('remembers the last tab', async () => {
    const first = open();
    await first.user.click(screen.getByRole('tab', { name: t('chat.work.tabs.tasks') }));
    expect(localStorage.getItem('spolu.attachTab')).toBe('tasks');
    first.view.unmount();
    open();
    expect(await screen.findByRole('tab', { name: /Tasks/, selected: true })).toBeInTheDocument();
  });

  it('searches tasks by title and tickets by number or subject', async () => {
    const { user } = open();
    await user.click(screen.getByRole('tab', { name: t('chat.work.tabs.tasks') }));
    await user.type(await screen.findByRole('searchbox'), 'budget');
    await vi.waitFor(() =>
      expect(vi.mocked(apiGet).mock.calls.map((c) => c[0])).toContain(
        '/groups/g1/tasks/search?q=budget',
      ),
    );
    await user.click(screen.getByRole('tab', { name: t('chat.work.tabs.tickets') }));
    await user.type(await screen.findByRole('searchbox'), '#7');
    await vi.waitFor(() =>
      expect(
        vi
          .mocked(apiGet)
          .mock.calls.map((c) => c[0])
          .join('\n'),
      ).toContain('q=%237'),
    );
  });

  it('stops at five tasks', async () => {
    vi.mocked(apiGet).mockImplementation(((path: string) =>
      Promise.resolve(
        path.includes('/tasks/search')
          ? { items: [1, 2, 3, 4, 5, 6].map((n) => task(`t${n}`, `Task ${n}`)), next: null }
          : answer(path),
      )) as never);
    const { user } = open();
    await user.click(screen.getByRole('tab', { name: t('chat.work.tabs.tasks') }));
    for (const n of [1, 2, 3, 4, 5]) {
      await user.click(await screen.findByRole('checkbox', { name: new RegExp(`Task ${n}`) }));
    }
    expect(screen.getByRole('checkbox', { name: /Task 6/ })).toBeDisabled();
    expect(screen.getByText(t('chat.work.limitTasks', { count: 5 }))).toBeInTheDocument();
  });
});

describe('attachment picker in the admin group (Phase 34 D)', () => {
  const paths = () => vi.mocked(apiGet).mock.calls.map((c) => c[0]);

  it('searches every client by default, with the client filter on each tab', async () => {
    const { user } = open(vi.fn(), 'admin');
    await user.click(screen.getByRole('tab', { name: t('chat.work.tabs.tasks') }));
    const row = await screen.findByRole('checkbox', { name: /Fix the budget/ });
    expect(paths()).toContain('/tasks/search');
    // The row names its client, with the manager dot for one of mine.
    const label = row.closest('label')!;
    await vi.waitFor(() => expect(label).toHaveTextContent('Obec Lúčky'));
    expect(label.querySelector('[data-managed-dot]')).not.toBeNull();
    // Knowledge: every client's items through the global list.
    await user.click(screen.getByRole('tab', { name: t('chat.work.tabs.knowledge') }));
    await vi.waitFor(() => expect(paths()).toContain('/knowledge?scope=all'));
    // Tickets: the global list of every client.
    await user.click(screen.getByRole('tab', { name: t('chat.work.tabs.tickets') }));
    await vi.waitFor(() => expect(paths()).toContain('/tickets/global?scope=all'));
  });

  it('orders the filter: eGrant tím, my clients with the dot, then the others', async () => {
    const { user } = open(vi.fn(), 'admin');
    await user.click(screen.getByRole('tab', { name: t('chat.work.tabs.tasks') }));
    await user.click(
      await screen.findByRole('button', { name: t('knowledge.clientFilter.pillAll') }),
    );
    const panel = await screen.findByRole('dialog', { name: t('knowledge.clientFilter.title') });
    const groups = within(panel).getAllByRole('group');
    expect(groups.map((g) => g.textContent)).toEqual([
      expect.stringContaining('eGrant tím'),
      expect.stringContaining('Obec Lúčky'),
      expect.stringContaining('Mesto Nitra'),
    ]);
    expect(groups[1]!.querySelector('[data-managed-dot]')).not.toBeNull();
    expect(groups[2]!.querySelector('[data-managed-dot]')).toBeNull();
    // Every client is checked by default; "Only my clients" narrows to the admin group and mine.
    expect(
      within(panel)
        .getAllByRole('checkbox')
        .every((b) => (b as HTMLInputElement).checked),
    ).toBe(true);
    await user.click(
      within(panel).getByRole('button', { name: t('knowledge.clientFilter.onlyMine') }),
    );
    await vi.waitFor(() => expect(paths()).toContain('/tasks/search?clients=admin%2Cg1'));
  });

  it('tickets leave eGrant tím out and offer "Without client"', async () => {
    const { user } = open(vi.fn(), 'admin');
    await user.click(screen.getByRole('tab', { name: t('chat.work.tabs.tickets') }));
    const without = await screen.findByRole('button', {
      name: t('chat.attach.clients.withoutClient'),
    });
    await user.click(without);
    await vi.waitFor(() => expect(paths()).toContain('/tickets/global?scope=none'));
    await user.click(without);
    await user.click(screen.getByRole('button', { name: t('knowledge.clientFilter.pillAll') }));
    const panel = await screen.findByRole('dialog', { name: t('knowledge.clientFilter.title') });
    expect(panel).not.toHaveTextContent('eGrant tím');
  });

  it('a client group keeps its own lists, without a client filter', async () => {
    const { user } = open();
    await user.click(screen.getByRole('tab', { name: t('chat.work.tabs.tasks') }));
    await screen.findByRole('checkbox', { name: /Fix the budget/ });
    expect(screen.queryByTestId('attach-client-filter')).toBeNull();
    expect(paths()).toContain('/groups/g1/tasks/search');
  });
});
