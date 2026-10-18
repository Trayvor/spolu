import { ListSkeleton } from '@/components/ui/skeleton';
import { memo, useEffect, useId, useMemo, useState } from 'react';
import { isClientGroup, type GroupMode, type GroupSummary } from '@spolu/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { adminsQuery } from '@/features/admins/api';
import { useSession } from '@/features/auth/use-session';
import { chatUnreadQuery } from '@/features/chat/api';
import { GroupUnreadCount, UnreadPill } from '@/features/chat/unread';
import { notificationModesQuery } from '@/features/notifications/api';
import { AllGroupsMode } from '@/features/notifications/all-groups-mode';
import { GroupBell, GroupBellOnDemand } from '@/features/notifications/mode-menu';
import { groupModeOf } from '@/features/notifications/use-modes';
import { groupsQuery } from './api';
import { GroupForm } from './group-form';
import { filterByManager, filterByName, isKnownManager, sortMineFirst } from './group-list';
import { GroupLogo } from './group-logo';
import { ManagerAvatars } from './manager-avatars';
import { ManagerFilter } from './manager-filter';
import { ManagerToggle } from './manager-toggle';
import { useRememberedFilters } from '@/lib/use-remembered-filters';

const MANAGER_KEYS = ['manager'] as const;

/** Rows drawn at first and added by each "Show more": the list holds thousands of clients. */
export const GROUPS_PAGE_SIZE = 50;

/**
 * Every client group with its unread chat count, its managers (names in a tooltip), the "Manage"
 * toggle, the bell and the member count (a link to the Members tab), and an inline "Create group"
 * form. Groups I manage come first. The manager filter (`?manager=me|none|<adminId>`) sits left
 * of "All groups: …"; the title shows the count, "shown of total" while filtered. Under 641px a
 * row wraps: logo, name and unread on the first line; avatars, toggle, bell and members on the
 * second, and the filter goes on its own line above "All groups".
 *
 * "Find a group" filters by name. The list draws the first 50 rows and "Show more" adds 50 (a
 * filter or search change starts again at 50); the count, the filter and the search cover every
 * group. The unread counts and the modes are read once
 * here, rows are memoized, and each bell mounts its menu on the first click.
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

  // "Find a group": by name, ignoring case and diacritics; not remembered.
  const [query, setQuery] = useState('');
  const findId = useId();
  const shown = useMemo(
    () =>
      groups ? sortMineFirst(filterByName(filterByManager(groups, manager, adminIds), query)) : [],
    [groups, manager, adminIds, query],
  );
  const filtered = groups !== undefined && shown.length !== groups.length;
  const groupIds = useMemo(() => groups?.map((g) => g.id) ?? [], [groups]);

  // How many rows are drawn; back to one page when the filter or the search changes.
  const listKey = `${manager ?? ''}\n${query}`;
  const [limit, setLimit] = useState({ listKey, rows: GROUPS_PAGE_SIZE });
  const rows = limit.listKey === listKey ? limit.rows : GROUPS_PAGE_SIZE;
  const visible = shown.length > rows ? shown.slice(0, rows) : shown;
  const left = shown.length - visible.length;

  const { data: unread } = useQuery(chatUnreadQuery);
  const { data: modes } = useQuery(notificationModesQuery);
  const role = me?.role;

  return (
    <div className="flex flex-col gap-6">
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
          <div className="flex w-full flex-col items-start gap-2 min-[641px]:w-auto min-[641px]:flex-row min-[641px]:items-center">
            <label htmlFor={findId} className="sr-only">
              {t('groups.find.label')}
            </label>
            <input
              id={findId}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('groups.find.label')}
              className="h-9 w-full rounded-md border-2 border-input bg-card px-3 text-tiny font-medium max-[640px]:h-11 placeholder:text-muted-foreground focus:border-foreground min-[641px]:w-56"
            />
            <ManagerFilter
              value={unknown ? undefined : manager}
              admins={admins ?? null}
              meId={me?.id ?? ''}
              onChange={(next) => setManager(next)}
            />
          </div>
          <AllGroupsMode groupIds={groupIds} />
        </div>
      )}
      {groups && groups.length > 0 && shown.length === 0 && query.trim() !== '' && (
        <p className="text-body text-muted-foreground">{t('groups.find.noMatch')}</p>
      )}
      {groups && groups.length > 0 && shown.length === 0 && query.trim() === '' && (
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
              {visible.map((group) => (
                <GroupRow
                  key={group.id}
                  group={group}
                  unread={unread?.[group.id] ?? 0}
                  mode={groupModeOf(modes, role, group.id).mode}
                />
              ))}
            </ul>
          </Card>
          {left > 0 && (
            <Button
              variant="outline"
              className="self-center"
              onClick={() => setLimit({ listKey, rows: rows + GROUPS_PAGE_SIZE })}
            >
              {t('groups.showMore', { left })}
            </Button>
          )}
          <p className="px-1 text-micro text-muted-foreground">
            {t('groups.managers.noManagerHint')}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * One client row. Memoized: the groups query keeps unchanged rows the same objects, so a change
 * to one group, one unread count or one mode redraws only that row.
 */
const GroupRow = memo(function GroupRow({
  group,
  unread,
  mode,
}: {
  group: GroupSummary;
  unread: number;
  mode: GroupMode | undefined;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-center gap-x-3 pr-3 pb-3 min-[641px]:flex-nowrap min-[641px]:pb-0 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border">
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
        <UnreadPill count={unread} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 gap-y-1 pl-5 min-[641px]:flex-none min-[641px]:pl-0">
        <ManagerAvatars managers={group.managers} groupName={group.name} />
        <ManagerToggle group={group} />
        <GroupBellOnDemand groupId={group.id} mode={mode} />
        <Link
          to="/groups/$groupId/members"
          params={{ groupId: group.id }}
          className="ml-auto inline-flex shrink-0 text-button text-muted-foreground underline-offset-2 hover:text-foreground hover:underline max-[640px]:min-h-11 max-[640px]:items-center max-[640px]:px-2 min-[641px]:ml-1"
        >
          {t('groups.members', { count: group.memberCount })}
        </Link>
      </div>
    </li>
  );
});

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
