import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/use-session';

// 32 px to see, a 44 px tap area on phones (the transparent `after`); the colour change eases.
const pill =
  "relative inline-flex h-8 shrink-0 items-center gap-2 rounded-full px-4 text-tiny font-semibold transition-colors duration-(--duration-fast) max-[640px]:after:absolute max-[640px]:after:inset-x-0 max-[640px]:after:-inset-y-1.5 max-[640px]:after:content-['']";

/** Per-tab extras, e.g. Phase 5's unread badge on the Chat tab. */
export type GroupTabBadges = Partial<
  Record<'overview' | 'chat' | 'tasks' | 'tickets' | 'knowledge' | 'members' | 'finance', ReactNode>
>;

/**
 * Overview (Phase 33), Chat, Tasks, Tickets, Knowledge, Members as filter pills: the current tab is the filled ink pill;
 * a finance admin (Phase 32) also has Financie, last.
 * They wrap from 641 px; on phones they stay on one line that scrolls sideways (no scrollbar), so
 * the chat keeps its height. The 6 px padding of that line holds the tap areas and focus rings.
 * A tab switch replaces the history entry (docs/design/README.md, "Navigation and Back").
 */
export function GroupTabs({ groupId, badges }: { groupId: string; badges?: GroupTabBadges }) {
  const { t } = useTranslation();
  const finance = useSession()?.finance === true;
  const tabs = [
    { key: 'overview', to: '/groups/$groupId/overview' },
    { key: 'chat', to: '/groups/$groupId/chat' },
    { key: 'tasks', to: '/groups/$groupId/tasks' },
    { key: 'tickets', to: '/groups/$groupId/tickets' },
    { key: 'knowledge', to: '/groups/$groupId/knowledge' },
    { key: 'members', to: '/groups/$groupId/members' },
    ...(finance ? [{ key: 'finance', to: '/groups/$groupId/finance' } as const] : []),
  ] as const;
  return (
    <nav
      aria-label={t('group.tabs.label')}
      className="flex gap-2 max-[640px]:-mx-3 max-[640px]:-my-1.5 max-[640px]:overflow-x-auto max-[640px]:px-3 max-[640px]:py-1.5 max-[640px]:[scrollbar-width:none] min-[641px]:flex-wrap"
    >
      {tabs.map(({ key, to }) => (
        <Link
          key={key}
          to={to}
          params={{ groupId }}
          // Switching tabs is not a step: Back leaves the group to where it was opened from.
          replace
          activeOptions={{ exact: false }}
          className={pill}
          activeProps={{ className: 'bg-primary text-primary-foreground' }}
          inactiveProps={{
            className: 'bg-secondary text-secondary-foreground hover:bg-surface-3',
          }}
        >
          {t(`group.tabs.${key}`)}
          {badges?.[key]}
        </Link>
      ))}
    </nav>
  );
}
