import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GroupPerson, Me } from '@spolu/shared';
import { setLanguage } from '@/i18n';
import { sessionQuery } from '@/features/auth/use-session';
import { groupPeopleQuery } from '@/features/groups/api';
import { AssigneeSelect } from './assignee-select';

const CLIENT: GroupPerson = { id: 'c1', name: 'Anna Nováková', isAdmin: false, isManager: false };
const MANAGER: GroupPerson = { id: 'm1', name: 'Mira Kováčová', isAdmin: true, isManager: true };
const OTHER_ADMIN: GroupPerson = { id: 'a2', name: 'Boris Kováč', isAdmin: true, isManager: false };

const ADMIN_ME: Me = {
  id: 'a9',
  name: 'Eva Admin',
  email: 'eva@example.com',
  role: 'admin',
  groupId: null,
} as Me;

function Harness({ initial, onValue }: { initial: string[]; onValue?: (ids: string[]) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <AssigneeSelect
      groupId="g1"
      inputId="assignees"
      value={value}
      onChange={(ids) => {
        setValue(ids);
        onValue?.(ids);
      }}
    />
  );
}

function renderSelect({
  people,
  initial = [],
  me = ADMIN_ME,
  onValue,
}: {
  people: GroupPerson[];
  initial?: string[];
  me?: Me | null;
  onValue?: (ids: string[]) => void;
}) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(groupPeopleQuery('g1').queryKey, people);
  client.setQueryData(sessionQuery.queryKey, me);
  render(
    <QueryClientProvider client={client}>
      <Harness initial={initial} onValue={onValue} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const optionNames = () =>
  within(screen.getByRole('listbox', { hidden: true }))
    .queryAllByRole('option', { hidden: true })
    .map((o) => o.textContent);

beforeAll(async () => {
  await setLanguage('en');
});

describe('AssigneeSelect', () => {
  it('the list offers clients and managers only', async () => {
    const user = renderSelect({ people: [CLIENT, MANAGER, OTHER_ADMIN] });
    await user.click(screen.getByRole('combobox'));
    expect(optionNames()).toEqual([
      expect.stringContaining('Anna Nováková'),
      expect.stringContaining('Mira Kováčová'),
    ]);
  });

  it('an existing non-manager assignee shows a chip with not a manager and can be removed, and is not offered again', async () => {
    const onValue = vi.fn();
    const user = renderSelect({
      people: [CLIENT, MANAGER, OTHER_ADMIN],
      initial: ['a2'],
      onValue,
    });
    const chip = screen.getByText('Boris Kováč').closest('li')!;
    expect(within(chip).getByText('eGrant')).toBeInTheDocument();
    expect(within(chip).getByText('not a manager')).toBeInTheDocument();
    await user.click(within(chip).getByRole('button', { name: 'Remove Boris Kováč' }));
    expect(onValue).toHaveBeenLastCalledWith([]);
    expect(screen.queryByText('not a manager')).toBeNull();
    await user.click(screen.getByRole('combobox'));
    expect(optionNames().join()).not.toContain('Boris');
  });

  it('a manager chip has no not a manager note', () => {
    renderSelect({ people: [CLIENT, MANAGER], initial: ['m1'] });
    expect(screen.getByText('Mira Kováčová')).toBeInTheDocument();
    expect(screen.queryByText('not a manager')).toBeNull();
  });

  it('a non-manager admin with an empty list sees the only-clients-and-managers line', async () => {
    const user = renderSelect({ people: [OTHER_ADMIN] });
    await user.click(screen.getByRole('combobox'));
    expect(
      screen.getByText("Only clients and the client's managers can be assigned."),
    ).toBeInTheDocument();
    expect(screen.queryByText('No one found.')).toBeNull();
  });

  it('a manager with an empty list sees the usual line', async () => {
    const user = renderSelect({
      people: [{ ...MANAGER, id: 'a9', name: 'Eva Admin' }],
      initial: ['a9'],
    });
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByText('No one found.')).toBeInTheDocument();
  });
});
