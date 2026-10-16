import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { GroupPerson } from '@spolu/shared';
import { PeopleSelect } from './people-select';

const PEOPLE: GroupPerson[] = [
  { id: 'u1', name: 'Anna Nováková', isAdmin: false },
  { id: 'u2', name: 'Boris Kováč', isAdmin: true },
  { id: 'u3', name: 'Cyril Hudec', isAdmin: false },
];

function Harness({
  people = PEOPLE,
  initial = [],
  fixedIds,
  onChange,
}: {
  people?: GroupPerson[];
  initial?: string[];
  fixedIds?: string[];
  onChange?: (ids: string[]) => void;
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
      />
    </>
  );
}

describe('PeopleSelect', () => {
  it('a fixed chip has no remove button and Backspace does not remove it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={['u1', 'u2']} fixedIds={['u1']} onChange={onChange} />);
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
    const user = userEvent.setup();
    render(<Harness people={PEOPLE.slice(0, 2)} />);
    await user.click(screen.getByRole('combobox', { name: 'Recipients' }));
    const options = within(screen.getByRole('listbox', { name: 'Recipients' })).getAllByRole(
      'option',
    );
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('Anna Nováková');
    expect(options[1]).toHaveTextContent('Boris Kováč');
    expect(screen.queryByText('Cyril Hudec')).not.toBeInTheDocument();
  });
});
