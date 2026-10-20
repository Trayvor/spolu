import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GroupPerson, Me } from '@spolu/shared';
import { setLanguage } from '@/i18n';
import { sessionQuery } from '@/features/auth/use-session';
import { PeopleSelect } from './people-select';

const PEOPLE: GroupPerson[] = [
  { id: 'u1', name: 'Anna Nováková', isAdmin: false, isManager: false },
  { id: 'u2', name: 'Boris Kováč', isAdmin: true, isManager: true },
  { id: 'u3', name: 'Cyril Hudec', isAdmin: false, isManager: false },
];

const CLIENT: GroupPerson = { id: 'c1', name: 'Anna Nováková', isAdmin: false, isManager: false };
const MANAGER: GroupPerson = { id: 'm1', name: 'Mira Kováčová', isAdmin: true, isManager: true };
const OTHER_ADMIN: GroupPerson = { id: 'a2', name: 'Boris Kováč', isAdmin: true, isManager: false };

const ADMIN_ME = {
  id: 'a9',
  name: 'Eva Admin',
  email: 'eva@example.com',
  role: 'admin',
  finance: false,
  groups: [],
} as Me;

function Harness({
  people = PEOPLE,
  initial = [],
  fixedIds,
  onChange,
  otherAdmins,
}: {
  people?: GroupPerson[];
  initial?: string[];
  fixedIds?: string[];
  onChange?: (ids: string[]) => void;
  otherAdmins?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="people">Recipients</label>
      <PeopleSelect
        people={people}
        value={value}
        onChange={(ids) => {
          onChange?.(ids);
          setValue(ids);
        }}
        fixedIds={fixedIds}
        inputId="people"
        max={10}
        label="Recipients"
        otherAdmins={otherAdmins}
      />
    </>
  );
}

function renderSelect(props: Parameters<typeof Harness>[0] = {}, me: Me | null = ADMIN_ME) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(sessionQuery.queryKey, me);
  render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
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

describe('PeopleSelect', () => {
  it('a fixed chip has no remove button and Backspace does not remove it', async () => {
    const onChange = vi.fn();
    const user = renderSelect({ initial: ['u1', 'u2'], fixedIds: ['u1'], onChange });
    const chips = screen.getAllByRole('listitem');
    expect(within(chips[0]!).getByText('Anna Nováková')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Anna Nováková' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Boris Kováč' })).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Recipients' }));
    await user.keyboard('{Backspace}{Backspace}{Backspace}');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Anna Nováková')).toBeInTheDocument();
    // The fixed person is not offered again either.
    expect(
      within(screen.getByRole('listbox', { name: 'Recipients' })).queryByText('Anna Nováková'),
    ).not.toBeInTheDocument();
  });

  it('lists only the given people', async () => {
    const user = renderSelect({ people: PEOPLE.slice(0, 2) });
    await user.click(screen.getByRole('combobox', { name: 'Recipients' }));
    const options = within(screen.getByRole('listbox', { name: 'Recipients' })).getAllByRole(
      'option',
    );
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('Anna Nováková');
    expect(options[1]).toHaveTextContent('Boris Kováč');
    expect(screen.queryByText('Cyril Hudec')).not.toBeInTheDocument();
  });

  it('the list offers clients and managers only', async () => {
    const user = renderSelect({ people: [CLIENT, MANAGER, OTHER_ADMIN] });
    await user.click(screen.getByRole('combobox'));
    expect(optionNames()).toEqual([
      expect.stringContaining('Anna Nováková'),
      expect.stringContaining('Mira Kováčová'),
    ]);
  });

  it('a chosen non-manager shows "not an account owner", can be removed and is not offered again', async () => {
    const onChange = vi.fn();
    const user = renderSelect({
      people: [CLIENT, MANAGER, OTHER_ADMIN],
      initial: ['a2'],
      onChange,
    });
    const chip = screen.getByText('Boris Kováč').closest('li')!;
    expect(within(chip).getByText('eGrant')).toBeInTheDocument();
    expect(within(chip).getByText('not an account owner')).toBeInTheDocument();
    await user.click(within(chip).getByRole('button', { name: 'Remove Boris Kováč' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.queryByText('not an account owner')).toBeNull();
    await user.click(screen.getByRole('combobox'));
    expect(optionNames().join()).not.toContain('Boris');
  });

  it('a fixed non-manager chip has no "not an account owner" note', () => {
    renderSelect({ people: [CLIENT, OTHER_ADMIN], initial: ['a2'], fixedIds: ['a2'] });
    expect(screen.getByText('Boris Kováč')).toBeInTheDocument();
    expect(screen.queryByText('not an account owner')).toBeNull();
  });

  it('a non-manager admin with an empty list sees who can be chosen', async () => {
    const user = renderSelect({ people: [OTHER_ADMIN] });
    await user.click(screen.getByRole('combobox'));
    expect(
      screen.getByText("Only clients and the client's account owners can be chosen."),
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

  describe('with otherAdmins (an admin assigning a task)', () => {
    const OTHER: GroupPerson = { id: 'a3', name: 'Adam Admin', isAdmin: true, isManager: false };

    it('lists clients and managers first, then the other admins under a heading, marked', async () => {
      const user = renderSelect({
        people: [OTHER, CLIENT, OTHER_ADMIN, MANAGER],
        otherAdmins: true,
      });
      await user.click(screen.getByRole('combobox'));
      expect(optionNames()).toEqual([
        expect.stringContaining('Anna Nováková'),
        expect.stringContaining('Mira Kováčová'),
        expect.stringContaining('Adam Admin'),
        expect.stringContaining('Boris Kováč'),
      ]);
      const list = screen.getByRole('listbox', { name: 'Recipients' });
      expect(within(list).getByText('Other admins')).toBeInTheDocument();
      // The mark is part of the option's accessible name.
      expect(
        within(list).getByRole('option', { name: /Boris Kováč.*not an account owner/ }),
      ).toBeVisible();
      expect(within(list).getByRole('option', { name: /Mira Kováčová/ })).not.toHaveTextContent(
        'not an account owner',
      );
    });

    it('a chosen other admin keeps "not an account owner" on the chip', async () => {
      const user = renderSelect({ people: [CLIENT, OTHER_ADMIN], otherAdmins: true });
      await user.click(screen.getByRole('combobox'));
      await user.click(screen.getByRole('option', { name: /Boris Kováč/ }));
      const chip = screen.getByRole('button', { name: 'Remove Boris Kováč' }).closest('li')!;
      expect(within(chip).getByText('not an account owner')).toBeInTheDocument();
    });

    it('no heading when there are no other admins, and no "who can be chosen" line', async () => {
      const user = renderSelect({ people: [CLIENT, MANAGER], otherAdmins: true });
      await user.click(screen.getByRole('combobox'));
      expect(screen.queryByText('Other admins')).toBeNull();
      await user.keyboard('zzz');
      expect(screen.getByText('No one found.')).toBeInTheDocument();
    });

    it('only other admins: the heading comes first, with no separator line', async () => {
      const user = renderSelect({ people: [OTHER_ADMIN], otherAdmins: true });
      await user.click(screen.getByRole('combobox'));
      expect(optionNames()).toEqual([expect.stringContaining('Boris Kováč')]);
      expect(screen.getByText('Other admins')).not.toHaveClass('border-t');
    });
  });
});
