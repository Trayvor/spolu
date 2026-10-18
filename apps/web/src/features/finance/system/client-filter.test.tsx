import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { GroupSummary } from '@spolu/shared';
import { groupsQuery } from '@/features/groups/api';
import { i18n, setLanguage } from '@/i18n';
import { clientsParam, financeKey } from '../api';
import { FinanceClientFilter, type FinanceClients } from './client-filter';

/** `/finance`'s client filter with the admin group "eGrant tím (internal)" (Phase 34 part E). */

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

const summary = (id: string, name: string, kind: 'client' | 'admin'): GroupSummary => ({
  id,
  name,
  kind,
  hasLogo: false,
  memberCount: 0,
  updatedAt: 'v',
  managers: [],
  managedByMe: false,
});
const GROUPS = [
  summary('a', 'Acme', 'client'),
  summary('b', 'Beta', 'client'),
  summary('team', 'eGrant tím', 'admin'),
];

function Harness({
  initial,
  onChange,
}: {
  initial: FinanceClients;
  onChange: (next: FinanceClients) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <FinanceClientFilter
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

function renderFilter(initial: FinanceClients = { clients: [], internal: false }) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(groupsQuery.queryKey, GROUPS);
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <Harness initial={initial} onChange={onChange} />
    </QueryClientProvider>,
  );
  return { onChange, user: userEvent.setup() };
}

const box = (panel: HTMLElement, name: string) =>
  within(panel).getByRole('checkbox', { name }) as HTMLInputElement;

describe('/finance client filter (Phase 34 part E)', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });

  it('the internal option is on top and off by default; ticking it keeps every client', async () => {
    const { onChange, user } = renderFilter();
    await user.click(screen.getByRole('button', { name: t('knowledge.clientFilter.pillAll') }));
    const panel = screen.getByRole('dialog');
    const groups = within(panel).getAllByRole('group');
    expect(groups[0]).toHaveAccessibleName(t('knowledge.clientFilter.internal'));
    expect(box(panel, 'eGrant tím').checked).toBe(false);
    expect(box(panel, 'Acme').checked).toBe(true);
    expect(box(panel, 'Beta').checked).toBe(true);

    await user.click(box(panel, 'eGrant tím'));
    expect(onChange).toHaveBeenLastCalledWith({ clients: [], internal: true });
    // Every client stays ticked next to it.
    expect(box(panel, 'Acme').checked).toBe(true);

    await user.click(box(panel, 'Beta'));
    expect(onChange).toHaveBeenLastCalledWith({ clients: ['a'], internal: true });
    await user.click(box(panel, 'Acme'));
    // The admin group alone.
    expect(onChange).toHaveBeenLastCalledWith({ clients: ['team'], internal: false });
  });

  it('restores a remembered internal choice as checked', async () => {
    const { user } = renderFilter({ clients: ['b'], internal: true });
    await user.click(
      screen.getByRole('button', { name: t('knowledge.clientFilter.pillSelected', { count: 2 }) }),
    );
    const panel = screen.getByRole('dialog');
    expect(box(panel, 'eGrant tím').checked).toBe(true);
    expect(box(panel, 'Beta').checked).toBe(true);
    expect(box(panel, 'Acme').checked).toBe(false);
  });

  it('sends `internal=1` and keys the cache by it', () => {
    expect(clientsParam({ kind: 'all', clients: [], internal: true })).toEqual({ internal: '1' });
    expect(clientsParam({ kind: 'all', clients: ['a'] })).toEqual({ clients: 'a' });
    expect(financeKey({ kind: 'all', clients: [], internal: true }, 'overview')).toEqual([
      'finance',
      'all',
      'overview',
      '',
      'internal',
    ]);
  });
});
