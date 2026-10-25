import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me, MeGroup } from '@spolu/shared';
import { sessionQuery } from '@/features/auth/use-session';
import { setLanguage } from '@/i18n';
import { SettingsPage } from './settings';

// Only which cards show is under test: each card is a marker.
vi.mock('@/features/profile/profile-section', () => ({ ProfileSection: () => null }));
vi.mock('@/features/notifications/settings-link', () => ({ NotificationsLinkCard: () => null }));
vi.mock('@/features/system/status-card', () => ({ StatusCard: () => null }));
vi.mock('@/features/calendar-feed/calendar-feed-section', () => ({
  CalendarFeedSection: () => null,
}));
vi.mock('@/features/passkeys/passkeys-section', () => ({
  PasskeysSection: () => <p>passkeys card</p>,
}));
vi.mock('@/features/snippets/snippets-section', () => ({
  SnippetsSection: () => <p>snippets card</p>,
}));
vi.mock('@/features/mcp/mcp-section', () => ({ McpSection: () => <p>mcp card</p> }));

const group = (role: MeGroup['role']): MeGroup => ({
  id: `g-${role}`,
  name: 'Firma',
  role,
  hasLogo: false,
  updatedAt: '2026-10-22T00:00:00.000Z',
});
const me = (role: Me['role'], groups: MeGroup[] = []): Me => ({
  id: 'u1',
  email: 'u@example.com',
  name: 'U',
  role,
  finance: false,
  groups,
});

function renderAs(user: Me) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(sessionQuery.queryKey, user as never);
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

describe('settings page: AI access (MCP)', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });

  it('an admin sees it with the admin cards', async () => {
    renderAs(me('admin'));
    expect(await screen.findByText('mcp card')).toBeInTheDocument();
    expect(await screen.findByText('snippets card')).toBeInTheDocument();
  });

  it('a manager sees it, without the admin cards (ADR 0071)', async () => {
    renderAs(me('client', [group('ziadatel'), group('client')]));
    expect(await screen.findByText('mcp card')).toBeInTheDocument();
    expect(screen.queryByText('snippets card')).not.toBeInTheDocument();
    expect(screen.queryByText('passkeys card')).not.toBeInTheDocument();
  });

  it('a žiadateľ never sees it', async () => {
    renderAs(me('client', [group('ziadatel')]));
    await screen.findByRole('heading', { level: 1 });
    // Give a lazy card the time it would need to appear.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('mcp card')).not.toBeInTheDocument();
  });
});
