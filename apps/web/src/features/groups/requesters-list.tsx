import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Member } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Toast } from '@/components/ui/toast';
import { removeMember, requestersQuery, restoreMember } from './api';

const ROW =
  'flex flex-col items-start gap-3 px-5 py-3 min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-between [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border';

type Change = { userId: string; restore: boolean; name: string; undo?: boolean };

function Who({ member }: { member: Member }) {
  return (
    <div className="min-w-0">
      <div className="font-semibold [overflow-wrap:anywhere]">{member.name || member.email}</div>
      {member.name && (
        <div className="truncate text-button text-muted-foreground">{member.email}</div>
      )}
    </div>
  );
}

/**
 * "Requesters" (Phase 21): the people who reported tickets for this client without being its
 * clients (`ziadatel` members); they see only their own tickets. Below the members, in the same
 * row pattern; admins remove and restore them at once, and each change shows a toast with
 * "Vrátiť späť" (5 s) that does the opposite. Nothing shows while there are none.
 */
export function RequestersList({ groupId, admin }: { groupId: string; admin: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const active = useQuery(requestersQuery(groupId)).data;
  const removed = useQuery({ ...requestersQuery(groupId, true), enabled: admin }).data;
  // The last change, offered for undo; `key` restarts the toast for the next one.
  const [done, setDone] = useState<{
    userId: string;
    name: string;
    restore: boolean;
    key: number;
  } | null>(null);
  const change = useMutation({
    mutationFn: ({ userId, restore }: Change) =>
      restore ? restoreMember(groupId, userId) : removeMember(groupId, userId),
    // An undone change is not offered for undo again (no toast, even while the list reloads).
    onSuccess: (_, { userId, restore, name, undo }) => {
      setDone(undo ? null : { userId, name, restore, key: Date.now() });
      return queryClient.invalidateQueries({ queryKey: ['groups', groupId] });
    },
  });
  const undo = (last: NonNullable<typeof done>) =>
    change.mutate({ userId: last.userId, restore: !last.restore, name: last.name, undo: true });

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
          <ul role="list">
            {active.map((member) => (
              <li key={member.id} className={ROW}>
                <Who member={member} />
                {admin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={change.isPending}
                    onClick={() =>
                      change.mutate({
                        userId: member.id,
                        restore: false,
                        name: member.name || member.email,
                      })
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
      {admin && removed && removed.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-3 text-button font-semibold">
            {t('group.requesters.removedTitle', { count: removed.length })}
          </summary>
          <Card className="mt-2 gap-0 py-2">
            <ul role="list">
              {removed.map((member) => (
                <li key={member.id} className={ROW}>
                  <Who member={member} />
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={change.isPending}
                    onClick={() =>
                      change.mutate({
                        userId: member.id,
                        restore: true,
                        name: member.name || member.email,
                      })
                    }
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
      {done && (
        <Toast
          key={done.key}
          duration={5000}
          onClose={() => setDone(null)}
          action={{ label: t('groups.undo'), onAction: () => undo(done) }}
        >
          {t(done.restore ? 'group.requesters.restored' : 'group.requesters.removed', {
            name: done.name,
          })}
        </Toast>
      )}
    </section>
  );
}
