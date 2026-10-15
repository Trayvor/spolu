import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Group } from '@spolu/shared';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { groupQuery, regenerateInvite } from './api';

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/** Admins only: one compact row with the invite link, Copy and an inline "new link" confirmation. */
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

  // "Copied" is brief.
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(id);
  }, [copied]);

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
    <section aria-labelledby="invite-title" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="invite-title" className="text-button font-semibold">
          {t('group.invite.title')}
        </h2>
        {/* Read-only, so the link stays selectable (and the copy fallback can select it). */}
        <input
          ref={fieldRef}
          readOnly
          aria-labelledby="invite-title"
          value={inviteUrl}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 basis-48 truncate rounded-sm bg-transparent text-tiny text-muted-foreground focus:text-foreground"
        />
        <div className="flex items-center gap-1">
          <Button type="button" variant="secondary" size="sm" onClick={() => void copy()}>
            <CopyIcon />
            {copied ? t('group.invite.copiedShort') : t('group.invite.copy')}
          </Button>
          {!confirming && (
            <Button
              ref={regenerateRef}
              variant="ghost"
              size="sm"
              onClick={() => {
                toggled.current = true;
                setConfirming(true);
              }}
            >
              {t('group.invite.regenerate')}
            </Button>
          )}
        </div>
      </div>
      {/* Always mounted, so screen readers announce the text when it is filled in. */}
      <p role="status" className="sr-only">
        {copied ? t('group.invite.copied') : null}
      </p>
      {confirming && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-tiny text-muted-foreground">{t('group.invite.confirm')}</p>
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
        </div>
      )}
      {regenerate.isError && (
        <p role="alert" className="text-micro text-error-ink">
          {t('errors.generic')}
        </p>
      )}
    </section>
  );
}
