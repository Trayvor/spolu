import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { clientGroups } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { GroupUnreadCount } from '@/features/chat/unread';
import { GroupLogo } from './group-logo';

/**
 * A client's groups when they belong to more than one (Phase 21): logo, name and unread chat
 * count, each opening the group's chat. Same rows as the admins' groups list, without its tools.
 */
export function MyGroupsPage() {
  const { t } = useTranslation();
  const me = useSession();
  const groups = me ? clientGroups(me) : [];

  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <h1 className="text-medium leading-tight font-semibold">{t('groups.mine.title')}</h1>
      {groups.length === 0 ? (
        <p className="text-body text-muted-foreground">{t('groups.mine.empty')}</p>
      ) : (
        <Card className="gap-0 py-2">
          <ul>
            {groups.map((group) => (
              <li
                key={group.id}
                className="[&:not(:last-child)]:border-b [&:not(:last-child)]:border-border"
              >
                <Link
                  to="/groups/$groupId/chat"
                  params={{ groupId: group.id }}
                  className="flex min-w-0 items-center gap-3 px-5 py-3 hover:text-ink-hover"
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
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
