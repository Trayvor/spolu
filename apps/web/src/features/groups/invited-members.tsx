import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Member } from '@spolu/shared';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { inviteToastKey } from './add-member-form';
import { cancelInvite, inviteMember } from './api';

/**
 * A person an admin invited by email who has not signed in yet: the "Invited" badge, Resend
 * (the same add again) and Remove, which cancels the invitation after an inline confirmation.
 * `row` is the members list's row class, so both lists stack the same way on phones.
 */
export function InvitedRow({
  groupId,
  member,
  row,
  onSent,
}: {
  groupId: string;
  member: Member;
  row: string;
  onSent: (text: string) => void;
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

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['groups'] });
  const resend = useMutation({
    mutationFn: () => inviteMember(groupId, { email: member.email }),
    onSuccess: async ({ outcome }) => {
      onSent(t(inviteToastKey(outcome), { email: member.email }));
      // `added`: they signed in meanwhile and are an ordinary member now.
      if (outcome !== 'resent') await refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: () => cancelInvite(groupId, member.id),
    onSuccess: refresh,
  });
  const failed = resend.isError || cancel.isError;

  return (
    <li className={row}>
      {confirming ? (
        <>
          <p className="text-button">
            {t('group.members.confirmCancelInvite', { email: member.email })}
          </p>
          <div className="flex gap-2">
            <Button
              ref={confirmRef}
              variant="destructive"
              size="sm"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              {t('group.members.remove')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                toggled.current = true;
                setConfirming(false);
                cancel.reset();
              }}
            >
              {t('group.members.cancel')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="min-w-0">
              <div className="truncate font-semibold">{member.name.trim() || member.email}</div>
              {member.name.trim() && (
                <div className="truncate text-button text-muted-foreground">{member.email}</div>
              )}
            </div>
            <Badge variant="outline">{t('group.members.invited')}</Badge>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={resend.isPending}
              onClick={() => resend.mutate()}
            >
              {t('group.members.resend')}
            </Button>
            <Button
              ref={removeRef}
              variant="ghost"
              size="sm"
              onClick={() => {
                toggled.current = true;
                setConfirming(true);
                resend.reset();
              }}
            >
              {t('group.members.remove')}
            </Button>
          </div>
        </>
      )}
      {failed && (
        <p role="alert" className="text-micro text-error-ink">
          {t('errors.generic')}
        </p>
      )}
    </li>
  );
}
