import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GroupPerson } from '@spolu/shared';
import { i18n } from '@/i18n';
import { RecipientsField } from './recipients-field';

const PEOPLE: GroupPerson[] = [
  { id: 'u1', name: 'Anna Nováková', isAdmin: false, isManager: false },
  { id: 'u2', name: 'Boris Kováč', isAdmin: true, isManager: true },
  { id: 'u3', name: 'Cyril Malý', isAdmin: false, isManager: false },
  { id: 'u4', name: 'Dana Veľká', isAdmin: true, isManager: true },
];

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

function Harness({ adminsOnly = false, initial }: { adminsOnly?: boolean; initial: string[] }) {
  const [value, setValue] = useState(initial);
  return (
    <RecipientsField
      groupId="g1"
      value={value}
      onChange={setValue}
      authorId="u2"
      adminsOnly={adminsOnly}
    />
  );
}

function renderField(props: Parameters<typeof Harness>[0]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(PEOPLE), { status: 200 })),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

describe('RecipientsField', () => {
  it('the author chip is fixed', async () => {
    const user = renderField({ initial: ['u1'] });
    expect(await screen.findByText('Boris Kováč')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t('forms.people.remove', { name: 'Boris Kováč' }) }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: t('forms.people.remove', { name: 'Anna Nováková' }) }),
    );
    const chips = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toContain('Boris Kováč');
  });

  it('admins-only lists admins only', async () => {
    const user = renderField({ initial: [], adminsOnly: true });
    await screen.findByText('Boris Kováč');
    await user.click(screen.getByRole('combobox', { name: t('reminders.fields.recipients') }));
    const list = screen.getByRole('listbox');
    const names = within(list)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(names).toHaveLength(1);
    expect(names[0]).toContain('Dana Veľká');
  });
});
