import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

const pill = 'inline-flex h-8 items-center gap-2 rounded-full px-4 text-tiny font-semibold';

/** Per-tab extras, e.g. Phase 5's unread badge on the Chat tab. */
export type GroupTabBadges = Partial<
  Record<'chat' | 'tasks' | 'tickets' | 'knowledge' | 'members', ReactNode>
>;

/** Chat, Tasks, Tickets, Knowledge, Members as filter pills: the current tab is the filled ink pill. */
export function GroupTabs({ groupId, badges }: { groupId: string; badges?: GroupTabBadges }) {
  const { t } = useTranslation();
  const tabs = [
    { key: 'chat', to: '/groups/$groupId/chat' },
    { key: 'tasks', to: '/groups/$groupId/tasks' },
    { key: 'tickets', to: '/groups/$groupId/tickets' },
    { key: 'knowledge', to: '/groups/$groupId/knowledge' },
    { key: 'members', to: '/groups/$groupId/members' },
  ] as const;
  return (
    <nav aria-label={t('group.tabs.label')} className="flex flex-wrap gap-2">
      {tabs.map(({ key, to }) => (
        <Link
          key={key}
          to={to}
          params={{ groupId }}
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
