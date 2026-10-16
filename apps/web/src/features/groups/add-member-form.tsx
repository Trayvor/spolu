import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { InviteMemberBodySchema, type InviteOutcome } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { inviteMember, restoreMember } from './api';

const TOAST_KEY: Record<InviteOutcome, string> = {
  invited: 'group.members.toastInvited',
  added: 'group.members.toastAdded',
  resent: 'group.members.toastResent',
};

/** The confirmation text for an add or a resend, by the server's outcome. */
export const inviteToastKey = (outcome: InviteOutcome): string => TOAST_KEY[outcome];

/** A 409 `removed` answer carries the removed member's id, for Restore. */
function removedUserId(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== 'removed') return null;
  const { userId } = (error.body ?? {}) as { userId?: unknown };
  return typeof userId === 'string' ? userId : null;
}

/**
 * Admins add a person to the group by email, name optional. The answer is a toast (`onSent`)
 * and the form closes; a known refusal shows under the email field. A removed member is not
 * added back: the form offers Restore instead.
 */
export function AddMemberForm({
  groupId,
  onClose,
  onSent,
}: {
  groupId: string;
  onClose: () => void;
  onSent: (text: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [invalid, setInvalid] = useState(false);

  const add = useMutation({
    mutationFn: () => inviteMember(groupId, { email, ...(name.trim() ? { name } : {}) }),
    onSuccess: async ({ member, outcome }) => {
      onSent(t(inviteToastKey(outcome), { email: member.email }));
      onClose();
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
  });
  const restore = useMutation({
    mutationFn: (userId: string) => restoreMember(groupId, userId),
    onSuccess: async () => {
      onClose();
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (add.isPending) return;
    const ok = InviteMemberBodySchema.safeParse({ email, name }).success;
    setInvalid(!ok);
    if (ok) add.mutate();
  }

  const removedId = removedUserId(add.error);
  const code = add.error instanceof ApiError ? add.error.code : undefined;
  const emailError = invalid
    ? t('group.members.invalidEmail')
    : code === 'already_member'
      ? t('group.members.alreadyMember')
      : code === 'email_taken_admin'
        ? t('group.members.emailTakenAdmin')
        : removedId
          ? t('group.members.removedMember')
          : null;
  const formError = add.isError && !emailError ? t('errors.generic') : null;
  const id = (field: string) => `add-member-${groupId}-${field}`;

  return (
    <Card className="p-5">
      <form
        noValidate
        aria-label={t('group.members.formLabel')}
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-2.5">
          <Label htmlFor={id('email')}>{t('group.members.email')}</Label>
          <Input
            id={id('email')}
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            autoFocus
            maxLength={254}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setInvalid(false);
              add.reset();
            }}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? id('email-error') : undefined}
          />
          {emailError && (
            <div className="-mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <p id={id('email-error')} className="text-micro text-error-ink">
                {emailError}
              </p>
              {removedId && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(removedId)}
                >
                  {t('group.members.restore')}
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2.5">
          <Label htmlFor={id('name')}>{t('group.members.nameOptional')}</Label>
          <Input
            id={id('name')}
            autoComplete="off"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {(formError || restore.isError) && (
          <p role="alert" className="text-micro text-error-ink">
            {t('errors.generic')}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={add.isPending}>
            {t('group.members.submit')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t('group.members.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
