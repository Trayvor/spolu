import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Group } from '@spolu/shared';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { groupQuery, regenerateInvite } from './api';

/** Admins only: the invite link with Copy and an inline "Generate new link" confirmation. */
export function InviteBox({ groupId, inviteUrl }: { groupId: string; inviteUrl: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fieldRef = useRef<HTMLInputElement>(null);
  const generateRef = useRef<HTMLButtonElement>(null);
  const regenerateRef = useRef<HTMLButtonElement>(null);
  const toggled = useRef(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Keep keyboard focus on the action: the confirmation button, then back to the trigger.
  useEffect(() => {
    if (!toggled.current) return;
    (confirming ? generateRef : regenerateRef).current?.focus();
  }, [confirming]);

  const regenerate = useMutation({
    mutationFn: () => regenerateInvite(groupId),
    onSuccess: (url) => {
      queryClient.setQueryData<Group>(groupQuery(groupId).queryKey, (old) =>
        old ? { ...old, inviteUrl: url } : old,
      );
      setCopied(false);
      toggled.current = true;
      setConfirming(false);
    },
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      // No clipboard access: select the text so the user can copy it by hand.
      setCopied(false);
      fieldRef.current?.focus();
      fieldRef.current?.select();
    }
  }

  return (
    <Card className="gap-4 p-5">
      <h2 id="invite-title" className="text-body font-semibold">
        {t('group.invite.title')}
      </h2>
      <div className="flex flex-col gap-2 min-[641px]:flex-row">
        <Input
          ref={fieldRef}
          readOnly
          aria-labelledby="invite-title"
          value={inviteUrl}
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button type="button" variant="secondary" onClick={() => void copy()}>
          {t('group.invite.copy')}
        </Button>
      </div>
      {/* Always mounted, so screen readers announce the text when it is filled in. */}
      <p role="status" className="text-button empty:hidden">
        {copied ? t('group.invite.copied') : null}
      </p>
      {confirming ? (
        <div className="flex flex-col gap-3">
          <p className="text-button">{t('group.invite.confirm')}</p>
          <div className="flex gap-2">
            <Button
              ref={generateRef}
              size="sm"
              disabled={regenerate.isPending}
              onClick={() => regenerate.mutate()}
            >
              {t('group.invite.generate')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                toggled.current = true;
                setConfirming(false);
                regenerate.reset();
              }}
            >
              {t('admins.cancel')}
            </Button>
          </div>
          {regenerate.isError && (
            <p role="alert" className="text-micro text-error-ink">
              {t('errors.generic')}
            </p>
          )}
        </div>
      ) : (
        <Button
          ref={regenerateRef}
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => {
            toggled.current = true;
            setConfirming(true);
          }}
        >
          {t('group.invite.regenerate')}
        </Button>
      )}
    </Card>
  );
}
