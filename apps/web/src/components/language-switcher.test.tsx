import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Me } from '@spolu/shared';
import userEvent from '@testing-library/user-event';
import { useTranslation } from 'react-i18next';
import { i18n, setLanguage } from '@/i18n';
import { SUPPORTED_LANGUAGES } from '@/i18n/languages';
import { sessionQuery } from '@/features/auth/use-session';
import { LanguageSwitcher } from './language-switcher';

/** Anonymous unless `signedIn`: the switcher reads the session to decide whether to save. */
function render(ui: ReactElement, signedIn = false) {
  // Fresh forever: the session is given, not fetched, so the only requests are the saves.
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  const me: Me = { id: 'u1', name: 'Eva', email: 'eva@example.com', role: 'client', groupId: 'g1' };
  queryClient.setQueryData(sessionQuery.queryKey, signedIn ? me : null);
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function Probe() {
  const { t } = useTranslation();
  return (
    <>
      <p data-testid="probe">{t('nav.settings')}</p>
      <LanguageSwitcher />
    </>
  );
}

describe('LanguageSwitcher', () => {
  beforeEach(async () => {
    localStorage.clear();
    await setLanguage('sk');
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('shows the current language code on a closed menu button', () => {
    render(<LanguageSwitcher />);
    const trigger = screen.getByRole('button', { name: 'Jazyk: Slovenčina' });
    expect(trigger).toHaveTextContent('SK');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('lists every supported language by its own name, the current one checked', async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);
    await user.click(screen.getByRole('button', { name: 'Jazyk: Slovenčina' }));

    // Radix names the menu after its trigger.
    expect(screen.getByRole('menu', { name: 'Jazyk: Slovenčina' })).toBeInTheDocument();
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent)).toEqual(
      SUPPORTED_LANGUAGES.map((lang) => lang.name),
    );
    expect(screen.getByRole('menuitemradio', { name: 'Slovenčina' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('switches the rendered text and persists the choice', async () => {
    const user = userEvent.setup();
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('Nastavenia');

    await user.click(screen.getByRole('button', { name: 'Jazyk: Slovenčina' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'English' }));

    expect(screen.getByTestId('probe')).toHaveTextContent('Settings');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Language: English' })).toHaveTextContent('EN');
    expect(localStorage.getItem('spolu.lang')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(i18n.language).toBe('en');
  });

  it('a signed-in change saves the language', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<LanguageSwitcher />, true);
    await user.click(screen.getByRole('button', { name: 'Jazyk: Slovenčina' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'English' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/me/language');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ language: 'en' });
  });

  it('an anonymous change saves nothing on the server', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<LanguageSwitcher />);
    await user.click(screen.getByRole('button', { name: 'Jazyk: Slovenčina' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'English' }));
    expect(i18n.language).toBe('en');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
