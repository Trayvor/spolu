import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Member } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { removeMember, requestersQuery, restoreMember } from './api';

const ROW =
  'flex flex-col gap-3 px-5 py-3 min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-between [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border';

function Who({ member }: { member: Member }) {
  return (
    <div className="min-w-0">
      <div className="font-semibold">{member.name || member.email}</div>
      {member.name && (
        <div className="truncate text-button text-muted-foreground">{member.email}</div>
      )}
    </div>
  );
}

/**
 * "Requesters" (Phase 21): the people who reported tickets for this client without being its
 * clients (`ziadatel` members); they see only their own tickets. Below the members, in the same
 * row pattern; admins remove (at once, it is undone with Restore) and restore them. Nothing
 * shows while there are none.
 */
export function RequestersList({ groupId, admin }: { groupId: string; admin: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const active = useQuery(requestersQuery(groupId)).data;
  const removed = useQuery({ ...requestersQuery(groupId, true), enabled: admin }).data;
  const change = useMutation({
    mutationFn: ({ userId, restore }: { userId: string; restore: boolean }) =>
      restore ? restoreMember(groupId, userId) : removeMember(groupId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['groups', groupId] }),
  });

  if ((active?.length ?? 0) === 0 && (removed?.length ?? 0) === 0) return null;
  return (
    <section aria-labelledby="requesters-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="requesters-title" className="text-body font-semibold">
          {t('group.requesters.title')}
        </h2>
        <p className="text-button text-muted-foreground">{t('group.requesters.hint')}</p>
      </div>
      {active && active.length > 0 && (
        <Card className="gap-0 py-2">
          <ul>
            {active.map((member) => (
              <li key={member.id} className={ROW}>
                <Who member={member} />
                {admin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={change.isPending}
                    onClick={() => change.mutate({ userId: member.id, restore: false })}
                  >
                    {t('group.members.remove')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {admin && removed && removed.length > 0 && (
        <details>
          <summary className="cursor-pointer py-2 text-button font-semibold">
            {t('group.requesters.removedTitle', { count: removed.length })}
          </summary>
          <Card className="mt-2 gap-0 py-2">
            <ul>
              {removed.map((member) => (
                <li key={member.id} className={ROW}>
                  <Who member={member} />
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={change.isPending}
                    onClick={() => change.mutate({ userId: member.id, restore: true })}
                  >
                    {t('group.members.restore')}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        </details>
      )}
      {change.isError && (
        <p role="alert" className="text-micro text-error-ink">
          {t('errors.generic')}
        </p>
      )}
    </section>
  );
}
