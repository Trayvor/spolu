import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ListSkeleton } from '@/components/ui/skeleton';
import { deactivatedGroupsQuery } from './api';
import { GroupLogo } from './group-logo';

/**
 * The Groups page's "Deactivated groups": a button under the list that shows the deactivated
 * client groups (fetched only when opened), each a link to its read-only page, where an admin
 * reactivates it. They are in no other list or picker.
 */
export function DeactivatedGroups() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data, isError } = useQuery({ ...deactivatedGroupsQuery, enabled: open });

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? t('groups.deactivated.hide') : t('groups.deactivated.show')}
      </Button>
      {open && isError && (
        <p role="alert" className="text-body">
          {t('errors.generic')}
        </p>
      )}
      {open && !data && !isError && <ListSkeleton rows={2} rowClassName="min-h-[56px]" />}
      {open && data && data.length === 0 && (
        <p className="text-body text-muted-foreground">{t('groups.deactivated.empty')}</p>
      )}
      {open && data && data.length > 0 && (
        <Card data-deactivated-groups="" className="w-full gap-0 py-2">
          <ul>
            {data.map((group) => (
              <li
                key={group.id}
                className="[&:not(:last-child)]:border-b [&:not(:last-child)]:border-border"
              >
                <Link
                  to="/groups/$groupId"
                  params={{ groupId: group.id }}
                  className="flex min-w-0 items-center gap-3 py-3 pl-5 text-muted-foreground hover:text-ink-hover"
                >
                  <GroupLogo
                    groupId={group.id}
                    name={group.name}
                    hasLogo={group.hasLogo}
                    version={group.updatedAt}
                  />
                  <span className="min-w-0 flex-1 truncate font-semibold">{group.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
