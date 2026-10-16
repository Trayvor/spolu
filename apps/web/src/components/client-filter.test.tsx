import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { i18n } from '@/i18n';
import { ClientFilter } from './client-filter';

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

const GROUPS = [
  { id: 'g1', name: 'Obec Lúčky', logoUrl: null },
  { id: 'g2', name: 'ABC s.r.o.', logoUrl: '/api/groups/g2/logo?v=1' },
  { id: 'g3', name: 'Mesto Nitra', logoUrl: null },
  { id: 'g4', name: 'Spolok Tatry', logoUrl: null },
];

/** A controlled filter whose `onChange` is spied on and applied. */
function Harness({
  managedIds,
  initial = null,
  onChange,
  disabled,
}: {
  managedIds: string[] | null;
  initial?: string[] | null;
  onChange?: (next: string[] | null) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<string[] | null>(initial);
  return (
    <ClientFilter
      groups={GROUPS}
      managedIds={managedIds}
      value={value}
      disabled={disabled}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
    />
  );
}

async function open(user: ReturnType<typeof userEvent.setup>, pill: string) {
  await user.click(screen.getByRole('button', { name: pill }));
  return screen.getByRole('dialog');
}

const names = (section: HTMLElement) =>
  within(section)
    .getAllByRole('checkbox')
    .map((box) => box.closest('label')?.textContent?.trim());

describe('ClientFilter', () => {
  it('two sections when managed ids exist, one list when null', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness managedIds={['g1', 'g2']} />);
    const panel = await open(user, t('knowledge.clientFilter.pillMine', { count: 2 }));
    const managed = within(panel).getByRole('group', { name: t('knowledge.clientFilter.managed') });
    const others = within(panel).getByRole('group', { name: t('knowledge.clientFilter.others') });
    expect(names(managed)).toEqual(['ABC s.r.o.', 'Obec Lúčky']);
    expect(names(others)).toEqual(['Mesto Nitra', 'Spolok Tatry']);
    // The default (managed) clients are checked.
    expect(
      within(managed)
        .getAllByRole('checkbox')
        .every((b) => (b as HTMLInputElement).checked),
    ).toBe(true);
    expect(
      within(others)
        .getAllByRole('checkbox')
        .some((b) => (b as HTMLInputElement).checked),
    ).toBe(false);
    unmount();

    render(<Harness managedIds={null} />);
    const single = await open(user, t('knowledge.clientFilter.pillAll'));
    expect(
      within(single).queryByRole('group', { name: t('knowledge.clientFilter.managed') }),
    ).toBeNull();
    const list = within(single).getByRole('group', { name: t('knowledge.clientFilter.clients') });
    expect(names(list)).toEqual(['ABC s.r.o.', 'Mesto Nitra', 'Obec Lúčky', 'Spolok Tatry']);
    expect(
      within(single).queryByRole('button', { name: t('knowledge.clientFilter.onlyMine') }),
    ).toBeNull();
  });

  it('find filters both sections', async () => {
    const user = userEvent.setup();
    render(<Harness managedIds={['g1', 'g2']} />);
    const panel = await open(user, t('knowledge.clientFilter.pillMine', { count: 2 }));
    // Without diacritics and case-insensitive.
    await user.type(within(panel).getByRole('searchbox'), 'lu');
    expect(
      names(within(panel).getByRole('group', { name: t('knowledge.clientFilter.managed') })),
    ).toEqual(['Obec Lúčky']);
    expect(
      within(panel).queryByRole('group', { name: t('knowledge.clientFilter.others') }),
    ).toBeNull();
    await user.clear(within(panel).getByRole('searchbox'));
    await user.type(within(panel).getByRole('searchbox'), 'tatr');
    expect(
      within(panel).queryByRole('group', { name: t('knowledge.clientFilter.managed') }),
    ).toBeNull();
    expect(
      names(within(panel).getByRole('group', { name: t('knowledge.clientFilter.others') })),
    ).toEqual(['Spolok Tatry']);
  });

  it('managed chips carry the dot', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness managedIds={['g1']} initial={['g1', 'g3']} onChange={onChange} />);
    expect(
      screen.getByRole('button', { name: t('knowledge.clientFilter.pillSelected', { count: 2 }) }),
    ).toBeInTheDocument();
    const chips = screen.getByRole('list', { name: t('knowledge.clientFilter.chosen') });
    const items = within(chips).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Obec Lúčky', 'Mesto Nitra']);
    expect(items[0]?.querySelector('[data-managed-dot]')).not.toBeNull();
    expect(items[1]?.querySelector('[data-managed-dot]')).toBeNull();
    await user.click(
      within(chips).getByRole('button', {
        name: t('knowledge.clientFilter.remove', { name: 'Mesto Nitra' }),
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith(['g1']);
    await user.click(screen.getByRole('button', { name: t('knowledge.clientFilter.reset') }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('the reset sits in the filter row, not in the chips row', () => {
    const { container, unmount } = render(
      <Harness managedIds={['g1']} initial={['g1', 'g2', 'g3', 'g4']} />,
    );
    const reset = screen.getByRole('button', { name: t('knowledge.clientFilter.reset') });
    expect(container.querySelector('.basis-full')).toBeNull();
    expect(reset).toHaveClass('order-1');
    expect(reset.parentElement).toBe(container);
    unmount();

    const chosen = render(<Harness managedIds={['g1']} initial={['g1', 'g3']} />);
    const chipsRow = chosen.container.querySelector('.basis-full');
    expect(chipsRow).not.toBeNull();
    const again = screen.getByRole('button', { name: t('knowledge.clientFilter.reset') });
    expect(chipsRow?.contains(again)).toBe(false);
    expect(again.parentElement).toBe(chosen.container);
  });

  it('no reset and no chips row on the default scope of every client', () => {
    const { container } = render(<Harness managedIds={null} />);
    expect(screen.queryByRole('button', { name: t('knowledge.clientFilter.reset') })).toBeNull();
    expect(container.querySelector('.basis-full')).toBeNull();
  });

  it('Only my clients and All clients', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness managedIds={['g1', 'g2']} onChange={onChange} />);
    const panel = await open(user, t('knowledge.clientFilter.pillMine', { count: 2 }));
    await user.click(within(panel).getByRole('checkbox', { name: 'Mesto Nitra' }));
    expect(onChange).toHaveBeenLastCalledWith(['g1', 'g2', 'g3']);
    await user.click(
      within(panel).getByRole('button', { name: t('knowledge.clientFilter.allClients') }),
    );
    expect(onChange).toHaveBeenLastCalledWith(['g1', 'g2', 'g3', 'g4']);
    expect(
      within(panel)
        .getAllByRole('checkbox')
        .every((b) => (b as HTMLInputElement).checked),
    ).toBe(true);
    await user.click(
      within(panel).getByRole('button', { name: t('knowledge.clientFilter.onlyMine') }),
    );
    expect(onChange).toHaveBeenLastCalledWith(null);
    await user.click(within(panel).getByRole('button', { name: t('knowledge.clientFilter.done') }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getByRole('button', { name: t('knowledge.clientFilter.pillMine', { count: 2 }) }),
    ).toBeInTheDocument();
  });

  it('no-managed hint', async () => {
    const user = userEvent.setup();
    render(<Harness managedIds={[]} />);
    const panel = await open(user, t('knowledge.clientFilter.pillAll'));
    expect(within(panel).getByText(t('knowledge.clientFilter.noManaged'))).toBeInTheDocument();
    expect(
      within(panel)
        .getAllByRole('checkbox')
        .every((b) => (b as HTMLInputElement).checked),
    ).toBe(true);
  });

  it('an explicit selection equal to the managed set reads My clients', () => {
    render(<Harness managedIds={['g1', 'g2']} initial={['g2', 'g1']} />);
    expect(
      screen.getByRole('button', { name: t('knowledge.clientFilter.pillMine', { count: 2 }) }),
    ).toBeInTheDocument();
  });

  it('stale ids are ignored', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness managedIds={null} initial={['g1', 'gone']} onChange={onChange} />);
    expect(
      screen.getByRole('button', { name: t('knowledge.clientFilter.pillSelected', { count: 1 }) }),
    ).toBeInTheDocument();
    const chips = screen.getByRole('list', { name: t('knowledge.clientFilter.chosen') });
    expect(
      within(chips)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Obec Lúčky']);
    const panel = await open(user, t('knowledge.clientFilter.pillSelected', { count: 1 }));
    await user.click(within(panel).getByRole('checkbox', { name: 'Mesto Nitra' }));
    expect(onChange).toHaveBeenLastCalledWith(['g1', 'g3']);
  });

  it('the pill is disabled while loading', () => {
    render(<Harness managedIds={null} disabled />);
    expect(
      screen.getByRole('button', { name: t('knowledge.clientFilter.pillAll') }),
    ).toBeDisabled();
  });
});
