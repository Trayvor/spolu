import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@tanstack/react-router', () => ({ Outlet: () => <p>Page</p> }));
vi.mock('@/components/app-header', () => ({
  AppHeader: () => <button type="button">Header</button>,
}));
const nav = vi.hoisted(() => ({ plan: null as object | null }));
vi.mock('@/components/bottom-nav', () => ({
  BottomNav: () => null,
  useBottomNav: () => nav.plan,
}));
vi.mock('@/components/offline-strip', () => ({ OfflineStrip: () => null }));
vi.mock('@/components/route-pending', () => ({ RoutePending: () => null }));
vi.mock('@/lib/use-sw-navigate', () => ({ useSwNavigate: () => undefined }));
vi.mock('@/lib/use-focus-on-route-change', () => ({ useFocusOnRouteChange: () => undefined }));
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

  it('lifts toasts above the phone bottom bar while the bar is shown', () => {
    const lift = () => document.documentElement.style.getPropertyValue('--toast-bottom');
    nav.plan = { items: [] };
    const { rerender, unmount } = render(<RootLayout />);
    expect(lift()).toContain('68px');
    nav.plan = null;
    rerender(<RootLayout />);
    expect(lift()).toBe('');
    nav.plan = { items: [] };
    rerender(<RootLayout />);
    unmount();
    expect(lift()).toBe('');
  });
});
