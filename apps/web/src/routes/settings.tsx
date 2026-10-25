import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/use-session';
import { NotificationsLinkCard } from '@/features/notifications/settings-link';
import { ProfileSection } from '@/features/profile/profile-section';
import { StatusCard } from '@/features/system/status-card';
import { withNamespaces } from '@/i18n/namespaces';

// "Kalendár" (ADR 0051): admins and clients; it renders nothing for a žiadateľ (403).
const CalendarFeedSection = lazy(
  withNamespaces(['calendarFeed'], () =>
    import('@/features/calendar-feed/calendar-feed-section').then((m) => ({
      default: m.CalendarFeedSection,
    })),
  ),
);

// "AI access (MCP)" is for admins and client managers (ADR 0071): its code and texts load only
// for them.
const McpSection = lazy(
  withNamespaces(['mcp'], () =>
    import('@/features/mcp/mcp-section').then((m) => ({ default: m.McpSection })),
  ),
);

// "Saved replies" (F7) likewise: admins only.
const SnippetsSection = lazy(
  withNamespaces(['snippets'], () =>
    import('@/features/snippets/snippets-section').then((m) => ({ default: m.SnippetsSection })),
  ),
);

// "Passkeys" (ADR 0050) likewise: admins only; the WebAuthn library loads only when one is added.
const PasskeysSection = lazy(
  withNamespaces(['passkeys'], () =>
    import('@/features/passkeys/passkeys-section').then((m) => ({ default: m.PasskeysSection })),
  ),
);

/**
 * /settings: the Profile, Notifications (a link to /settings/notifications), Calendar, Passkeys,
 * Saved replies (admins), AI access (admins and managers) and System status cards, in that order.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const user = useSession();
  const admin = user !== null && user.role !== 'client';
  // A manager: a client with an active `client` membership (never a pure žiadateľ).
  const mcp = admin || (user?.groups ?? []).some((g) => g.role === 'client');
  return (
    <div className="flex max-w-[552px] flex-col gap-6">
      <h1 className="text-medium leading-tight font-semibold">{t('nav.settings')}</h1>
      <ProfileSection />
      <NotificationsLinkCard />
      {user !== null && (
        <Suspense fallback={null}>
          <CalendarFeedSection />
        </Suspense>
      )}
      {admin && (
        <Suspense fallback={null}>
          <PasskeysSection />
          <SnippetsSection />
        </Suspense>
      )}
      {mcp && (
        <Suspense fallback={null}>
          <McpSection />
        </Suspense>
      )}
      <StatusCard />
    </div>
  );
}
