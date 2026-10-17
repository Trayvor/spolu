import { ListSkeleton } from '@/components/ui/skeleton';
import { useEffect, useMemo, useState } from 'react';
import { isClientGroup, type GroupSummary } from '@spolu/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { adminsQuery } from '@/features/admins/api';
import { useSession } from '@/features/auth/use-session';
import { GroupUnreadCount } from '@/features/chat/unread';
import { AllGroupsMode } from '@/features/notifications/all-groups-mode';
import { GroupBell } from '@/features/notifications/mode-menu';
import { groupsQuery } from './api';
import { GroupForm } from './group-form';
import { filterByManager, isKnownManager, sortMineFirst } from './group-list';
import { GroupLogo } from './group-logo';
import { ManagerAvatars } from './manager-avatars';
import { ManagerFilter } from './manager-filter';
import { ManagerToggle } from './manager-toggle';
import { useRememberedFilters } from '@/lib/use-remembered-filters';

const MANAGER_KEYS = ['manager'] as const;

/**
 * Every client group with its unread chat count, its managers (names in a tooltip), the "Manage"
 * toggle, the bell and the member count (a link to the Members tab), and an inline "Create group"
 * form. Groups I manage come first. The manager filter (`?manager=me|none|<adminId>`) sits left
 * of "All groups: …"; the title shows the count, "shown of total" while filtered. Under 641px a
 * row wraps: logo, name and unread on the first line; avatars, toggle, bell and members on the
 * second, and the filter goes on its own line above "All groups".
 */
export function GroupsPage() {
  const { t } = useTranslation();
  const me = useSession();
  const navigate = useNavigate();
  // The last manager filter comes back on the next visit ("Everyone" forgets it).
  const { manager } = useRememberedFilters(
    'groups',
    MANAGER_KEYS,
    useSearch({ strict: false }) as { manager?: string },
  );
  const { data: all, isError, refetch } = useQuery(groupsQuery);
  // The admin group (Phase 34) is pinned above the list and counts as no client.
  const adminGroup = all?.find((g) => !isClientGroup(g));
  const groups = useMemo(() => all?.filter(isClientGroup), [all]);
  const { data: admins } = useQuery(adminsQuery);
  const [formOpen, setFormOpen] = useState(false);

  const adminIds = useMemo(() => (admins ? new Set(admins.map((a) => a.id)) : null), [admins]);
  const setManager = (next: string | undefined, replace = false) =>
    void navigate({ to: '/groups', search: next ? { manager: next } : {}, replace });
  // An old link to an admin who is gone: back to every group rather than an unexplained list.
  const unknown = manager !== undefined && adminIds !== null && !isKnownManager(manager, adminIds);
  useEffect(() => {
    if (unknown) void navigate({ to: '/groups', search: {}, replace: true });
  }, [unknown, navigate]);

  const shown = useMemo(
    () => (groups ? sortMineFirst(filterByManager(groups, manager, adminIds)) : []),
    [groups, manager, adminIds],
  );
  const filtered = groups !== undefined && shown.length !== groups.length;

  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <div className="flex flex-col gap-4 min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-between">
        <div className="flex items-baseline gap-2">
          <h1 className="text-medium leading-tight font-semibold">{t('groups.title')}</h1>
          {groups && groups.length > 0 && (
            <span data-group-count="" className="text-medium leading-tight text-muted-foreground">
              {filtered
                ? t('groups.count.filtered', { shown: shown.length, total: groups.length })
                : groups.length}
            </span>
          )}
        </div>
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
      {!groups && !isError && <ListSkeleton rows={5} rowClassName="min-h-[68px]" />}
      {adminGroup && <AdminGroupRow group={adminGroup} />}
      {groups && groups.length === 0 && !formOpen && (
        <p className="text-body text-muted-foreground">{t('groups.empty')}</p>
      )}
      {groups && groups.length > 0 && (
        <div className="flex flex-col items-start gap-2 min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-between">
          <ManagerFilter
            value={unknown ? undefined : manager}
            admins={admins ?? null}
            meId={me?.id ?? ''}
            onChange={(next) => setManager(next)}
          />
          <AllGroupsMode groupIds={groups.map((g) => g.id)} />
        </div>
      )}
      {groups && groups.length > 0 && shown.length === 0 && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-body text-muted-foreground">{t('groups.filter.empty')}</p>
          <Button variant="outline" size="sm" onClick={() => setManager(undefined)}>
            {t('groups.filter.clear')}
          </Button>
        </div>
      )}
      {shown.length > 0 && (
        <div className="flex flex-col gap-2">
          <Card className="gap-0 py-2">
            <ul>
              {shown.map((group) => (
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
                    <Link
                      to="/groups/$groupId/members"
                      params={{ groupId: group.id }}
                      className="ml-auto inline-flex shrink-0 text-button text-muted-foreground underline-offset-2 hover:text-foreground hover:underline max-[640px]:min-h-11 max-[640px]:items-center max-[640px]:px-2 min-[641px]:ml-1"
                    >
                      {t('groups.members', { count: group.memberCount })}
                    </Link>
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

/**
 * The admin group "eGrant tím", pinned above the clients: its logo (the egrant mark by default),
 * name and unread count, and the bell. No managers, no Manage toggle and no members link: every
 * admin is in it.
 */
function AdminGroupRow({ group }: { group: GroupSummary }) {
  const { t } = useTranslation();
  return (
    <Card data-admin-group="" className="gap-0 py-0">
      <div className="flex items-center gap-x-3 pr-3">
        <Link
          to="/groups/$groupId"
          params={{ groupId: group.id }}
          className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-5 hover:text-ink-hover"
        >
          <GroupLogo
            groupId={group.id}
            name={group.name}
            hasLogo={group.hasLogo}
            version={group.updatedAt}
            admin
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-semibold">{group.name}</span>
            <span className="text-micro text-muted-foreground">{t('groups.adminGroup.hint')}</span>
          </span>
          <GroupUnreadCount groupId={group.id} />
        </Link>
        <GroupBell groupId={group.id} />
      </div>
    </Card>
  );
}
