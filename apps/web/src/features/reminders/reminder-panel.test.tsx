import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Me, ReminderSetDto } from '@spolu/shared';
import { ApiError } from '@/lib/api';
import { i18n } from '@/i18n';
import { subscribeReminder, unsubscribeReminder } from './api';
import { ReminderPanel } from './reminder-panel';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  subscribeReminder: vi.fn(async () => undefined),
  unsubscribeReminder: vi.fn(async () => undefined),
}));

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

const ME: Me = {
  id: 'u2',
  email: 'b@example.com',
  name: 'Boris Kováč',
  role: 'admin',
  groupId: null,
};
const HOUR = 3_600_000;
const future = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

function set(overrides: Partial<ReminderSetDto> = {}): ReminderSetDto {
  return {
    times: [
      { id: 't1', at: future(48), firedAt: null },
      { id: 't0', at: future(-48), firedAt: future(-48) },
    ],
    recipients: [
      { user: { id: 'u3', name: 'Cyril Malý' }, source: 'added' },
      { user: { id: 'u1', name: 'Anna Nováková' }, source: 'author' },
    ],
    subscribed: false,
    canEdit: false,
    ...overrides,
  };
}

function renderPanel(reminder: ReminderSetDto, authorId = 'u1', onChanged = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['session'], ME);
  render(
    <QueryClientProvider client={client}>
      <ReminderPanel
        prefix="/knowledge"
        subjectId="k1"
        set={reminder}
        authorId={authorId}
        onChanged={onChanged}
      />
    </QueryClientProvider>,
  );
  return { onChanged };
}

afterEach(() => vi.clearAllMocks());

describe('ReminderPanel', () => {
  it('Remind me toggles subscribe/unsubscribe', async () => {
    const user = userEvent.setup();
    const { onChanged } = renderPanel(set());
    const toggle = screen.getByRole('button', { name: t('reminders.panel.remindMe') });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(subscribeReminder).toHaveBeenCalledWith('/knowledge', 'k1');
    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'));
    expect(onChanged).toHaveBeenCalled();
    await user.click(toggle);
    expect(unsubscribeReminder).toHaveBeenCalledWith('/knowledge', 'k1');
    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'false'));
  });

  it('lists recipients author first, and fired times as sent', () => {
    renderPanel(set());
    const names = screen.getByTestId('reminder-recipients').textContent ?? '';
    expect(names.indexOf('Anna Nováková')).toBeLessThan(names.indexOf('Cyril Malý'));
    expect(screen.getByText(t('reminders.panel.sent'))).toBeInTheDocument();
  });

  it('a subscribe that finds no reminder set reports it as unavailable', async () => {
    vi.mocked(subscribeReminder).mockRejectedValueOnce(
      new ApiError('gone', 404, { error: 'no_reminder_set' }),
    );
    const user = userEvent.setup();
    const { onChanged } = renderPanel(set());
    await user.click(screen.getByRole('button', { name: t('reminders.panel.remindMe') }));
    expect(await screen.findByText(t('reminders.panel.unavailable'))).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it("author's toggle is on and disabled with the hint", () => {
    renderPanel(set({ subscribed: true }), 'u2');
    const toggle = screen.getByRole('button', { name: t('reminders.panel.remindMe') });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toBeDisabled();
    expect(screen.getByText(t('reminders.panel.authorHint'))).toBeInTheDocument();
  });

  it('Add to calendar is disabled with no upcoming time and links to calendar.ics otherwise', () => {
    renderPanel(set({ times: [{ id: 't0', at: future(-48), firedAt: future(-48) }] }));
    expect(screen.queryByRole('link', { name: t('reminders.panel.addToCalendar') })).toBeNull();
    expect(screen.getByRole('button', { name: t('reminders.panel.noUpcoming') })).toBeDisabled();
    cleanup();
    renderPanel(set());
    const link = screen.getByRole('link', { name: t('reminders.panel.addToCalendar') });
    expect(link).toHaveAttribute('href', '/api/knowledge/k1/reminders/calendar.ics');
    expect(link).toHaveAttribute('download');
  });
});
