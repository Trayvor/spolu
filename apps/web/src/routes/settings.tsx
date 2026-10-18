import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/use-session';
import { NotificationsSection } from '@/features/notifications/notifications-section';
import { ProfileSection } from '@/features/profile/profile-section';
import { StatusCard } from '@/features/system/status-card';
import { withNamespaces } from '@/i18n/namespaces';

// "AI access (MCP)" is for admins only: its code and texts load only for them.
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
 * /settings: the Profile, Notifications, Passkeys, Saved replies and AI access (admins) and
 * System status cards, in that order.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const user = useSession();
  const admin = user !== null && user.role !== 'client';
  return (
    <div className="flex max-w-[552px] flex-col gap-6">
      <h1 className="text-medium leading-tight font-semibold">{t('nav.settings')}</h1>
      <ProfileSection />
      <NotificationsSection />
      {admin && (
        <Suspense fallback={null}>
          <PasskeysSection />
          <SnippetsSection />
          <McpSection />
        </Suspense>
      )}
      <StatusCard />
    </div>
  );
}
