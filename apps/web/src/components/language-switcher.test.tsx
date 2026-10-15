import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTranslation } from 'react-i18next';
import { i18n, setLanguage } from '@/i18n';
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

  it('shows both languages as a radio group with the current one checked', () => {
    render(<LanguageSwitcher />);
    const group = screen.getByRole('radiogroup', { name: 'Jazyk' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Slovenčina' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'English' })).toHaveTextContent('EN');
  });

  it('switches the rendered text and persists the choice', async () => {
    const user = userEvent.setup();
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('Nastavenia');

    await user.click(screen.getByRole('radio', { name: 'English' }));

    expect(screen.getByTestId('probe')).toHaveTextContent('Settings');
    expect(screen.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('spolu.lang')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(i18n.language).toBe('en');
  });
});
