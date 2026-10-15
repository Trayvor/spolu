import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTranslation } from 'react-i18next';
import { i18n, setLanguage } from '@/i18n';
import { SUPPORTED_LANGUAGES } from '@/i18n/languages';
import { LanguageSwitcher } from './language-switcher';

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
  afterEach(() => localStorage.clear());

  it('shows the current language code on a closed menu button', () => {
    render(<LanguageSwitcher />);
    const trigger = screen.getByRole('button', { name: 'Jazyk' });
    expect(trigger).toHaveTextContent('SK');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('lists every supported language by its own name, the current one checked', async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);
    await user.click(screen.getByRole('button', { name: 'Jazyk' }));

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

    await user.click(screen.getByRole('button', { name: 'Jazyk' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'English' }));

    expect(screen.getByTestId('probe')).toHaveTextContent('Settings');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Language' })).toHaveTextContent('EN');
    expect(localStorage.getItem('spolu.lang')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(i18n.language).toBe('en');
  });
});
