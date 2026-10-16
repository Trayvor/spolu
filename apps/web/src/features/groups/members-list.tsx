import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Member } from '@spolu/shared';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Toast } from '@/components/ui/toast';
import { useSession } from '@/features/auth/use-session';
import { AddMemberForm } from './add-member-form';
import {
  invitedMembersQuery,
  membersQuery,
  removeMember,
  removedMembersQuery,
  restoreMember,
} from './api';
import { InvitedRow } from './invited-members';

const ROW =
  'flex flex-col gap-3 px-5 py-3 min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-between [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border';

function Who({ member }: { member: Member }) {
  return (
    <div className="min-w-0">
      <div className="font-semibold">{member.name}</div>
      <div className="truncate text-button text-muted-foreground">{member.email}</div>
    </div>
  );
}

/**
 * Members of a group. Admins also add people by email ("+ Add member" opens the form under the
 * heading), see the invited people who have not signed in yet above the members in the same
 * card, remove members and see the collapsed removed members.
 */
export function MembersList({ groupId, admin }: { groupId: string; admin: boolean }) {
  const { t } = useTranslation();
  const me = useSession();
  const { data: members } = useQuery(membersQuery(groupId));
  const { data: invited = [] } = useQuery({ ...invitedMembersQuery(groupId), enabled: admin });
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const titleId = `members-${groupId}`;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id={titleId} className="text-body font-semibold">
          {t('group.members.title')}
        </h2>
        {admin && !adding && (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            {t('group.members.add')}
          </Button>
        )}
      </div>
      {adding && (
        <AddMemberForm groupId={groupId} onClose={() => setAdding(false)} onSent={setToast} />
      )}
      {members && members.length + invited.length === 0 && (
        <p className="text-body text-muted-foreground">{t('group.members.empty')}</p>
      )}
      {members && members.length + invited.length > 0 && (
        <Card className="gap-0 py-2">
          <ul aria-labelledby={titleId}>
            {invited.map((person) => (
              <InvitedRow
                key={person.id}
                groupId={groupId}
                member={person}
                row={ROW}
                onSent={setToast}
              />
            ))}
            {members.map((member) => (
              <MemberRow
                key={member.id}
                groupId={groupId}
                member={member}
                isMe={member.id === me?.id}
                canRemove={admin}
              />
            ))}
          </ul>
        </Card>
      )}
      {admin && <RemovedMembers groupId={groupId} />}
      {toast && (
        <Toast key={toast} onClose={() => setToast(null)}>
          {toast}
        </Toast>
      )}
    </section>
  );
}

function MemberRow({
  groupId,
  member,
  isMe,
  canRemove,
}: {
  groupId: string;
  member: Member;
  isMe: boolean;
  canRemove: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const toggled = useRef(false);

  // Keep keyboard focus on the row's action: the confirmation button, then back to Remove.
  useEffect(() => {
    if (!toggled.current) return;
    (confirming ? confirmRef : removeRef).current?.focus();
  }, [confirming]);

  const remove = useMutation({
    mutationFn: () => removeMember(groupId, member.id),
    // Members, removed members and the member count on the list.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['groups'] }),
  });

  return (
    <li className={ROW}>
      {confirming ? (
        <>
          <p className="text-button">{t('group.members.confirmRemove', { name: member.name })}</p>
          <div className="flex gap-2">
            <Button
              ref={confirmRef}
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {t('group.members.remove')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                toggled.current = true;
                setConfirming(false);
                remove.reset();
              }}
            >
              {t('admins.cancel')}
            </Button>
          </div>
          {remove.isError && (
            <p role="alert" className="text-micro text-error-ink">
              {t('errors.generic')}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Who member={member} />
            {isMe && <Badge variant="outline">{t('group.members.you')}</Badge>}
          </div>
          {canRemove && (
            <Button
              ref={removeRef}
              variant="ghost"
              size="sm"
              onClick={() => {
                toggled.current = true;
                setConfirming(true);
              }}
            >
              {t('group.members.remove')}
            </Button>
          )}
        </>
      )}
    </li>
  );
}

function RemovedMembers({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: removed } = useQuery(removedMembersQuery(groupId));
  const restore = useMutation({
    mutationFn: (userId: string) => restoreMember(groupId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['groups'] }),
  });

  if (!removed || removed.length === 0) return null;
  return (
    <details className="group/removed">
      <summary className="cursor-pointer py-2 text-button font-semibold">
        {t('group.members.removedTitle', { count: removed.length })}
      </summary>
      <Card className="mt-2 gap-0 py-2">
        <ul>
          {removed.map((member) => (
            <li key={member.id} className={ROW}>
              <Who member={member} />
              <Button
                variant="ghost"
                size="sm"
                disabled={restore.isPending}
                onClick={() => restore.mutate(member.id)}
              >
                {t('group.members.restore')}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      {restore.isError && (
        <p role="alert" className="mt-2 text-micro text-error-ink">
          {t('errors.generic')}
        </p>
      )}
    </details>
  );
}
