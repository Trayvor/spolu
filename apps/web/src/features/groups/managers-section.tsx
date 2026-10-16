import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/avatar';
import { Card } from '@/components/ui/card';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { useGroupPeople } from './use-group-people';

/** The members list's row, without the actions column. */
const ROW =
  'flex items-center gap-3 px-5 py-3 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border';

/**
 * The group's eGrant managers, above the members on the Members tab. Read-only here: admins get
 * a link to the Groups page, where managers are chosen.
 */
export function ManagersSection({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const admin = isAdmin(useSession());
  const { data: people } = useGroupPeople(groupId);
  if (!people) return null;
  const managers = people.filter((p) => p.isManager);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-body font-semibold">{t('groups.managers.title')}</h2>
        {admin && (
          <Link
            to="/groups"
            className="text-button text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {t('groups.managers.changeLink')}
          </Link>
        )}
      </div>
      {managers.length === 0 ? (
        <p className="text-body text-muted-foreground">{t('groups.managers.none')}</p>
      ) : (
        <Card className="gap-0 py-2">
          <ul>
            {managers.map((manager) => (
              <li key={manager.id} className={ROW}>
                <Avatar userId={manager.id} name={manager.name} size={32} />
                <span className="min-w-0 truncate font-semibold">{manager.name}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
