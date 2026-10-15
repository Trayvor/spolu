import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { GroupUnreadCount } from '@/features/chat/unread';
import { groupsQuery } from './api';
import { GroupForm } from './group-form';
import { GroupLogo } from './group-logo';

/**
 * Admin home: every client group with its unread chat count and member count, and an inline
 * "Create group" form.
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
      {groups && groups.length > 0 && (
        <Card className="gap-0 py-2">
          <ul>
            {groups.map((group) => (
              <li
                key={group.id}
                className="[&:not(:last-child)]:border-b [&:not(:last-child)]:border-border"
              >
                <Link
                  to="/groups/$groupId"
                  params={{ groupId: group.id }}
                  className="flex items-center gap-3 px-5 py-3 hover:text-ink-hover"
                >
                  <GroupLogo
                    groupId={group.id}
                    name={group.name}
                    hasLogo={group.hasLogo}
                    version={group.updatedAt}
                  />
                  <span className="min-w-0 flex-1 truncate font-semibold">{group.name}</span>
                  <GroupUnreadCount groupId={group.id} />
                  <span className="shrink-0 text-button text-muted-foreground">
                    {t('groups.members', { count: group.memberCount })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
