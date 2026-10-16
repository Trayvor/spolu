import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { i18n } from '@/i18n';
import {
  ReminderTimesField,
  isoToLocal,
  localToIso,
  type ReminderTimeValue,
} from './reminder-times-field';

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

function Harness({
  initial,
  errors,
}: {
  initial: ReminderTimeValue[];
  errors?: Record<number, string>;
}) {
  const [value, setValue] = useState(initial);
  return <ReminderTimesField value={value} onChange={setValue} errors={errors} />;
}

const row = (date: string, time: string, extra: Partial<ReminderTimeValue> = {}) => ({
  date,
  time,
  firedAt: null,
  ...extra,
});

describe('ReminderTimesField', () => {
  it('fired rows are read-only and cannot be removed', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[
          row('2026-10-12', '10:00', { id: 't1', firedAt: '2026-10-12T08:00:00.000Z' }),
          row('2030-01-02', '09:00', { id: 't2' }),
        ]}
      />,
    );
    const firedDate = screen.getByLabelText(t('reminders.fields.date', { n: 1 }));
    expect(firedDate).toHaveAttribute('readonly');
    expect(screen.getByLabelText(t('reminders.fields.time', { n: 1 }))).toHaveAttribute('readonly');
    expect(screen.getByText(t('reminders.fields.sent'))).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t('reminders.fields.remove', { n: 1 }) }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('reminders.fields.remove', { n: 2 }) }));
    expect(screen.queryByLabelText(t('reminders.fields.date', { n: 2 }))).not.toBeInTheDocument();
    expect(screen.getByLabelText(t('reminders.fields.date', { n: 1 }))).toHaveValue('2026-10-12');
  });

  it('marks rows with their errors', () => {
    render(
      <Harness
        initial={[row('2026-10-12', '10:00')]}
        errors={{ 0: t('reminders.fields.errors.passed') }}
      />,
    );
    expect(screen.getByText(t('reminders.fields.errors.passed'))).toBeInTheDocument();
    expect(screen.getByLabelText(t('reminders.fields.date', { n: 1 }))).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('focuses the new date after Add, and the next Remove or Add after Remove', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[row('2030-01-01', '09:00'), row('2030-01-02', '09:00')]} />);
    await user.click(screen.getByRole('button', { name: t('reminders.fields.add') }));
    expect(screen.getByLabelText(t('reminders.fields.date', { n: 3 }))).toHaveFocus();

    await user.click(screen.getByRole('button', { name: t('reminders.fields.remove', { n: 1 }) }));
    // The rows renumber: the old second row is now the first.
    expect(
      screen.getByRole('button', { name: t('reminders.fields.remove', { n: 1 }) }),
    ).toHaveFocus();
    expect(screen.getByLabelText(t('reminders.fields.date', { n: 1 }))).toHaveValue('2030-01-02');

    await user.click(screen.getByRole('button', { name: t('reminders.fields.remove', { n: 2 }) }));
    expect(screen.getByRole('button', { name: t('reminders.fields.add') })).toHaveFocus();
  });

  it('keeps each new row its own input state when an earlier row is removed', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[]} />);
    await user.click(screen.getByRole('button', { name: t('reminders.fields.add') }));
    await user.click(screen.getByRole('button', { name: t('reminders.fields.add') }));
    const second = screen.getByLabelText(t('reminders.fields.date', { n: 2 }));
    await user.click(screen.getByRole('button', { name: t('reminders.fields.remove', { n: 1 }) }));
    // The same element moved up: it was not re-created from the first row's key.
    expect(screen.getByLabelText(t('reminders.fields.date', { n: 1 }))).toBe(second);
  });

  it('Add time hides at 20', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={Array.from({ length: 19 }, (_, i) =>
          row(`2030-01-${String(i + 1).padStart(2, '0')}`, '09:00'),
        )}
      />,
    );
    await user.click(screen.getByRole('button', { name: t('reminders.fields.add') }));
    expect(screen.getByLabelText(t('reminders.fields.date', { n: 20 }))).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t('reminders.fields.add') }),
    ).not.toBeInTheDocument();
  });

  it('localToIso round-trips', () => {
    const iso = localToIso('2026-10-23', '14:05');
    expect(new Date(iso).getHours()).toBe(14);
    expect(new Date(iso).getMinutes()).toBe(5);
    expect(isoToLocal(iso)).toEqual({ date: '2026-10-23', time: '14:05' });
    expect(localToIso('2026-10-23', '')).toBe('');
  });
});
