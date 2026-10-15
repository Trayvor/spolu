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

  it('switches the rendered text and persists the choice', async () => {
    const user = userEvent.setup();
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('Nastavenia');

    await user.click(screen.getByRole('button', { name: 'Jazyk' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'English' }));

    expect(screen.getByTestId('probe')).toHaveTextContent('Settings');
    expect(localStorage.getItem('spolu.lang')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(i18n.language).toBe('en');
  });
});
