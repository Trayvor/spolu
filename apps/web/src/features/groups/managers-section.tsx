import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Toast } from '@/components/ui/toast';
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
 * ("+ Add manager") and remove any manager here, without a confirmation: a removal shows a toast
 * "<name> už nie je manažérom" with "Vrátiť späť" (5 s), which adds the manager back (the server
 * restores the notification mode that becoming manager wrote). Clients only read the list.
 */
export function ManagersSection({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const admin = isAdmin(useSession());
  const queryClient = useQueryClient();
  const { data: people } = useGroupPeople(groupId);
  // The last removal, offered for undo; `key` restarts the toast for a second removal.
  const [removed, setRemoved] = useState<{ userId: string; name: string; key: number } | null>(
    null,
  );
  const change = useMutation({
    mutationFn: ({ userId, add }: { userId: string; add: boolean; name: string }) =>
      add ? setManager(groupId, userId) : unsetManager(groupId, userId),
    onSuccess: (_, { userId, add, name }) => {
      setRemoved(add ? null : { userId, name, key: Date.now() });
      // The people (who is a manager) and the Groups page's avatars. The socket event refreshes
      // other screens, and the viewer's own modes when they removed themselves.
      return queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
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
            onPick={(userId) => change.mutate({ userId, add: true, name: '' })}
          />
        )}
      </div>
      {managers.length === 0 ? (
        <p className="text-body text-muted-foreground">{t('groups.managers.none')}</p>
      ) : (
        <Card className="gap-0 py-2">
          <ul role="list" aria-labelledby={titleId}>
            {managers.map((manager) => (
              <li key={manager.id} className={ROW}>
                <Avatar userId={manager.id} name={manager.name} size={32} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-semibold">{manager.name}</span>
                  {manager.substitutesFor && (
                    <span className="truncate text-micro text-muted-foreground">
                      {t('groups.managers.substitutes', { name: manager.substitutesFor })}
                    </span>
                  )}
                </span>
                {admin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={change.isPending}
                    aria-label={t('groups.managers.remove', { name: manager.name })}
                    onClick={() =>
                      change.mutate({ userId: manager.id, add: false, name: manager.name })
                    }
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
      {removed && (
        <Toast
          key={removed.key}
          duration={5000}
          onClose={() => setRemoved(null)}
          action={{
            label: t('groups.undo'),
            onAction: () => change.mutate({ userId: removed.userId, add: true, name: '' }),
          }}
        >
          {t('groups.managers.removed', { name: removed.name })}
        </Toast>
      )}
    </section>
  );
}
