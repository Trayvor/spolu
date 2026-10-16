import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { AddManagerMenu } from './add-manager-menu';
import { setManager, unsetManager } from './api';
import { useGroupPeople } from './use-group-people';

/** The members list's row, with Remove on the right for admins. */
const ROW =
  'flex items-center gap-3 px-5 py-3 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border';

/**
 * The group's eGrant managers, above the members on the Members tab. Admins add any active admin
 * ("+ Add manager") and remove any manager here, without a confirmation (adding back is one
 * click). Clients only read the list.
 */
export function ManagersSection({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const admin = isAdmin(useSession());
  const queryClient = useQueryClient();
  const { data: people } = useGroupPeople(groupId);
  const change = useMutation({
    mutationFn: ({ userId, add }: { userId: string; add: boolean }) =>
      add ? setManager(groupId, userId) : unsetManager(groupId, userId),
    // The people (who is a manager) and the Groups page's avatars. The socket event refreshes
    // other screens, and the viewer's own modes when they removed themselves.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['groups'] }),
  });
  if (!people) return null;
  const managers = people.filter((p) => p.isManager);
  const titleId = `managers-${groupId}`;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id={titleId} className="text-body font-semibold">
          {t('groups.managers.title')}
        </h2>
        {admin && (
          <AddManagerMenu
            people={people}
            disabled={change.isPending}
            onPick={(userId) => change.mutate({ userId, add: true })}
          />
        )}
      </div>
      {managers.length === 0 ? (
        <p className="text-body text-muted-foreground">{t('groups.managers.none')}</p>
      ) : (
        <Card className="gap-0 py-2">
          <ul aria-labelledby={titleId}>
            {managers.map((manager) => (
              <li key={manager.id} className={ROW}>
                <Avatar userId={manager.id} name={manager.name} size={32} />
                <span className="min-w-0 flex-1 truncate font-semibold">{manager.name}</span>
                {admin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={change.isPending}
                    aria-label={t('groups.managers.remove', { name: manager.name })}
                    onClick={() => change.mutate({ userId: manager.id, add: false })}
                  >
                    {t('group.members.remove')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {change.isError && (
        <p role="alert" className="text-micro text-error-ink">
          {t('groups.managers.error')}
        </p>
      )}
    </section>
  );
}
