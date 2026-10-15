import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const pill = 'inline-flex h-8 items-center gap-2 rounded-full px-4 text-tiny font-semibold';

/** Per-tab extras, e.g. Phase 5's unread badge on the Chat tab. */
export type GroupTabBadges = Partial<Record<'chat' | 'tasks' | 'members', ReactNode>>;

/** Chat, Tasks, Members as filter pills: the current tab is the filled ink pill. */
export function GroupTabs({ groupId, badges }: { groupId: string; badges?: GroupTabBadges }) {
  const { t } = useTranslation();
  const tabs = [
    { key: 'chat', to: '/groups/$groupId/chat' },
    { key: 'tasks', to: '/groups/$groupId/tasks' },
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
          className={cn(pill, 'bg-secondary text-secondary-foreground hover:bg-surface-3')}
          activeProps={{ className: 'bg-primary text-primary-foreground hover:bg-primary' }}
        >
          {t(`group.tabs.${key}`)}
          {badges?.[key]}
        </Link>
      ))}
    </nav>
  );
}
