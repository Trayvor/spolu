import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@tanstack/react-router', () => ({ Outlet: () => <p>Page</p> }));
vi.mock('@/components/app-header', () => ({
  AppHeader: () => <button type="button">Header</button>,
}));
vi.mock('@/components/bottom-nav', () => ({
  BottomNav: () => null,
  useBottomNav: () => null,
}));
vi.mock('@/components/offline-strip', () => ({ OfflineStrip: () => null }));
vi.mock('@/components/route-pending', () => ({ RoutePending: () => null }));
vi.mock('@/lib/use-sw-navigate', () => ({ useSwNavigate: () => undefined }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { RootLayout } from './root';

describe('RootLayout', () => {
  it('starts with a skip link that moves the focus to the main landmark', async () => {
    const user = userEvent.setup();
    render(<RootLayout />);
    await user.tab();
    const link = screen.getByRole('link', { name: 'app.skipToContent' });
    expect(link).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('main')).toHaveFocus();
  });
});
