import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@/i18n';
import { AddReminderRow } from './add-reminder-row';
import { localToIso } from './reminder-times-field';

const t = (key: string) => i18n.t(key);

describe('AddReminderRow', () => {
  it('defaults to the given date and 09:00', () => {
    render(<AddReminderRow defaultDate="2030-01-15" onAdd={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText(t('reminders.row.date'))).toHaveValue('2030-01-15');
    expect(screen.getByLabelText(t('reminders.row.time'))).toHaveValue('09:00');
    expect(screen.getByLabelText(t('reminders.row.date'))).toHaveFocus();
  });

  it('Enter calls onAdd with localToIso; Add and Cancel', async () => {
    const onAdd = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<AddReminderRow defaultDate="2030-01-15" onAdd={onAdd} onCancel={onCancel} />);
    await user.type(screen.getByLabelText(t('reminders.row.time')), '{Enter}');
    expect(onAdd).toHaveBeenCalledWith(localToIso('2030-01-15', '09:00'));
    await user.click(screen.getByRole('button', { name: t('reminders.row.confirm') }));
    expect(onAdd).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: t('reminders.row.cancel') }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows the error', () => {
    render(
      <AddReminderRow
        defaultDate="2030-01-15"
        onAdd={vi.fn()}
        onCancel={vi.fn()}
        error="This time has passed. Pick a later one."
      />,
    );
    const error = screen.getByText('This time has passed. Pick a later one.');
    const date = screen.getByLabelText(t('reminders.row.date'));
    expect(date).toHaveAttribute('aria-describedby', error.id);
    expect(date).toHaveAttribute('aria-invalid', 'true');
  });
});
