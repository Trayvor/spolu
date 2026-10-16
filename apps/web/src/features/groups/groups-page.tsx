import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { GroupUnreadCount } from '@/features/chat/unread';
import { AllGroupsMode } from '@/features/notifications/all-groups-mode';
import { GroupBell } from '@/features/notifications/mode-menu';
import { groupsQuery } from './api';
import { GroupForm } from './group-form';
import { GroupLogo } from './group-logo';
import { ManagerAvatars } from './manager-avatars';
import { ManagerToggle } from './manager-toggle';

/**
 * Admin home: every client group with its unread chat count, its managers, the "Manage" toggle,
 * the bell and the member count, and an inline "Create group" form. Under 641px a row wraps:
 * logo, name and unread on the first line; avatars, toggle, bell and members on the second.
 */
export function GroupsPage() {
  const { t } = useTranslation();
  const { data: groups, isError, refetch } = useQuery(groupsQuery);
  const [formOpen, setFormOpen] = useState(false);

  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <div className="flex flex-col gap-4 min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-between">
        <h1 className="text-medium leading-tight font-semibold">{t('groups.title')}</h1>
        {!formOpen && (
          <Button className="w-full min-[641px]:w-auto" onClick={() => setFormOpen(true)}>
            {t('groups.create')}
          </Button>
        )}
      </div>

      {formOpen && (
        <GroupForm onCancel={() => setFormOpen(false)} onSaved={() => setFormOpen(false)} />
      )}

      {isError && !groups && (
        <div className="flex flex-col items-start gap-3" role="alert">
          <p className="text-body">{t('errors.generic')}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            {t('errors.retry')}
          </Button>
        </div>
      )}
      {groups && groups.length === 0 && !formOpen && (
        <p className="text-body text-muted-foreground">{t('groups.empty')}</p>
      )}
      {groups && groups.length > 0 && <AllGroupsMode groupIds={groups.map((g) => g.id)} />}
      {groups && groups.length > 0 && (
        <div className="flex flex-col gap-2">
          <Card className="gap-0 py-2">
            <ul>
              {groups.map((group) => (
                <li
                  key={group.id}
                  className="flex flex-wrap items-center gap-x-3 pr-3 pb-3 min-[641px]:flex-nowrap min-[641px]:pb-0 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border"
                >
                  <Link
                    to="/groups/$groupId"
                    params={{ groupId: group.id }}
                    className="flex min-w-0 basis-full items-center gap-3 py-3 pl-5 hover:text-ink-hover min-[641px]:flex-1 min-[641px]:basis-auto"
                  >
                    <GroupLogo
                      groupId={group.id}
                      name={group.name}
                      hasLogo={group.hasLogo}
                      version={group.updatedAt}
                    />
                    <span className="min-w-0 flex-1 truncate font-semibold">{group.name}</span>
                    <GroupUnreadCount groupId={group.id} />
                  </Link>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 gap-y-1 pl-5 min-[641px]:flex-none min-[641px]:pl-0">
                    <ManagerAvatars managers={group.managers} groupName={group.name} />
                    <ManagerToggle group={group} />
                    <GroupBell groupId={group.id} />
                    <span className="ml-auto shrink-0 text-button text-muted-foreground min-[641px]:ml-1">
                      {t('groups.members', { count: group.memberCount })}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <p className="px-1 text-micro text-muted-foreground">
            {t('groups.managers.noManagerHint')}
          </p>
        </div>
      )}
    </div>
  );
}
