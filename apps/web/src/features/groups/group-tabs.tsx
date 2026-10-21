import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { GroupKind } from '@spolu/shared';
import { useSession } from '@/features/auth/use-session';

// The client's menu (2026-10-21): text tabs on one hairline, the current one ink with a 2 px ink
// underline, the others muted. 40 px high (44 px on phones); the transparent `before` widens the
// tap area over half the gap on each side. Distinct from action buttons and filter pills.
const tab =
  "relative inline-flex h-10 shrink-0 items-center gap-2 text-button font-semibold transition-colors duration-(--duration-fast) before:absolute before:inset-y-0 before:-inset-x-3 before:content-[''] focus-visible:-outline-offset-2 max-[640px]:h-11";
const current =
  "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground after:content-['']";

/** Per-tab extras, e.g. Phase 5's unread badge on the Chat tab. */
export type GroupTabBadges = Partial<
  Record<'overview' | 'chat' | 'tasks' | 'tickets' | 'knowledge' | 'members' | 'finance', ReactNode>
>;

/**
 * Overview (Phase 33), Chat, Tasks, Tickets, Knowledge, Members as the client's menu: underlined
 * text tabs on a hairline (the current one ink, underlined), never pills, so they do not read as
 * actions or filters;
 * a finance admin (Phase 32) also has Financie, last. The admin group (Phase 34) has no Tickets
 * and no Members.
 * They wrap from 641 px; on phones they stay on one line that scrolls sideways (no scrollbar), so
 * the chat keeps its height. The hairline is an inset shadow, so the scrolling line does not clip
 * the underline.
 * A tab switch replaces the history entry (docs/design/README.md, "Navigation and Back").
 */
export function GroupTabs({
  groupId,
  kind = 'client',
  badges,
}: {
  groupId: string;
  kind?: GroupKind;
  badges?: GroupTabBadges;
}) {
  const { t } = useTranslation();
  const finance = useSession()?.finance === true;
  const client = kind === 'client';
  const tabs = [
    { key: 'overview', to: '/groups/$groupId/overview' },
    { key: 'chat', to: '/groups/$groupId/chat' },
    { key: 'tasks', to: '/groups/$groupId/tasks' },
    ...(client ? [{ key: 'tickets', to: '/groups/$groupId/tickets' } as const] : []),
    { key: 'knowledge', to: '/groups/$groupId/knowledge' },
    ...(client ? [{ key: 'members', to: '/groups/$groupId/members' } as const] : []),
    ...(finance ? [{ key: 'finance', to: '/groups/$groupId/finance' } as const] : []),
  ] as const;
  return (
    <nav
      aria-label={t('group.tabs.label')}
      className="flex gap-x-6 shadow-[inset_0_-1px_0_var(--border)] max-[640px]:-mx-3 max-[640px]:overflow-x-auto max-[640px]:px-3 max-[640px]:[scrollbar-width:none] min-[641px]:flex-wrap"
    >
      {tabs.map(({ key, to }) => (
        <Link
          key={key}
          to={to}
          params={{ groupId }}
          // Switching tabs is not a step: Back leaves the group to where it was opened from.
          replace
          activeOptions={{ exact: false }}
          className={tab}
          activeProps={{ className: current }}
          inactiveProps={{ className: 'text-muted-foreground hover:text-foreground' }}
        >
          {t(`group.tabs.${key}`)}
          {badges?.[key]}
        </Link>
      ))}
    </nav>
  );
}
