import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Me } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { loadAllNamespaces } from '@/i18n/namespaces';
import { sessionQuery } from '@/features/auth/use-session';
import { PhoneNavSetting } from './phone-nav-setting';

const ME: Me = {
  id: 'u1',
  name: 'Ada',
  email: 'a@x.sk',
  role: 'admin',
  finance: false,
  groups: [],
};

function setup(putStatus = 204) {
  const puts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      puts.push(JSON.parse(init!.body as string));
      return new Response(null, { status: putStatus });
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(sessionQuery.queryKey, ME);
  render(
    <QueryClientProvider client={queryClient}>
      <PhoneNavSetting />
    </QueryClientProvider>,
  );
  const phoneNav = () => (queryClient.getQueryData(sessionQuery.queryKey) as Me).phoneNav;
  return { puts, phoneNav, user: userEvent.setup() };
}

const radio = (key: 'classic' | 'bottom') =>
  screen.getByRole('radio', { name: i18n.t(`settings.profile.phoneNav.${key}`) });

describe('PhoneNavSetting', () => {
  beforeEach(async () => {
    await setLanguage('en');
    await loadAllNamespaces();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows Classic as the default and says it is for phones', () => {
    setup();
    expect(radio('classic')).toBeChecked();
    expect(radio('bottom')).not.toBeChecked();
    expect(screen.getByText(i18n.t('settings.profile.phoneNav.hint'))).toBeInTheDocument();
  });

  it('switches at once in the session and saves the choice', async () => {
    const { puts, phoneNav, user } = setup();
    await user.click(radio('bottom'));
    expect(phoneNav()).toBe('bottom');
    expect(radio('bottom')).toBeChecked();
    await waitFor(() => expect(puts).toEqual([{ phoneNav: 'bottom' }]));
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('rolls back and shows an error when the save fails', async () => {
    const { phoneNav, user } = setup(500);
    await user.click(radio('bottom'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(phoneNav()).toBe('classic');
  });
});
