import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorCodes, type BulkAudience, type BulkNotReadyProblem } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { ApiError } from '@/lib/api';
import {
  audienceCountQuery,
  campaignListKey,
  campaignQuery,
  markPhoneCheckShown,
  sendCampaign,
  senderQuery,
} from './api';
import { notReadyProblems } from './test-send';
import type { SaveState } from './use-autosave';

/** Save states from which a flush cannot bring the draft to "saved". */
const STUCK: SaveState[] = ['invalid', 'changed', 'notDraft'];

/**
 * Step 4 of the editor: "Send…" saves what still waits (the send reads the campaign as saved),
 * then asks in a dialog with the subject, the sender and the live recipient count.
 */
export function SendStep({
  campaignId,
  subject,
  audience,
  saveState,
  flush,
  onProblems,
  phoneFollows,
  phoneCheckShown,
  onShowPhone,
}: {
  campaignId: string;
  subject: string;
  audience: BulkAudience;
  saveState: SaveState;
  flush: () => Promise<boolean>;
  onProblems: (problems: BulkNotReadyProblem[]) => void;
  /** The phone version still follows the desktop one (Phase 31). */
  phoneFollows: boolean;
  /** The one-time phone warning was shown for this campaign already (server-side). */
  phoneCheckShown: boolean;
  /** "Show phone preview": switch the editor to Phone and show the preview. */
  onShowPhone: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [preparing, setPreparing] = useState(false);
  const [open, setOpen] = useState(false);
  const [phoneCheck, setPhoneCheck] = useState(false);
  // Shown in this editor already, before the server's answer reached the campaign.
  const [warned, setWarned] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // `not_ready` reasons without a block (e.g. no subject) are shown here; the rest at the block.
  const [general, setGeneral] = useState<BulkNotReadyProblem[]>([]);

  const start = async () => {
    setMessage(null);
    setGeneral([]);
    setPreparing(true);
    const saved = await flush();
    setPreparing(false);
    if (!saved) {
      setMessage(t('bulkEmail.send.unsaved'));
      return;
    }
    if (phoneFollows && !phoneCheckShown && !warned) {
      // Once per campaign (spec §5): remembered on the server when it is shown.
      setWarned(true);
      setPhoneCheck(true);
      void markPhoneCheckShown(campaignId)
        .then(() =>
          queryClient.setQueryData(campaignQuery(campaignId).queryKey, (c) =>
            c ? { ...c, phoneCheckShown: true } : c,
          ),
        )
        .catch(() => undefined);
      return;
    }
    setOpen(true);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-[640px] text-button text-muted-foreground">{t('bulkEmail.send.intro')}</p>
      <Button
        type="button"
        className="w-full min-[641px]:w-auto min-[641px]:self-start"
        disabled={preparing || STUCK.includes(saveState)}
        onClick={() => void start()}
      >
        {preparing ? t('bulkEmail.send.preparing') : t('bulkEmail.send.open')}
      </Button>
      {saveState === 'invalid' && (
        <p className="text-micro text-muted-foreground">{t('bulkEmail.send.unsaved')}</p>
      )}
      <p role="status" className="text-micro text-error-ink empty:hidden">
        {message}
      </p>
      {general.map((p) => (
        <p key={p.problem} className="text-micro text-error-ink">
          {t(`bulkEmail.notReady.${p.problem}`)}
        </p>
      ))}
      {phoneCheck && (
        <SheetDialog
          onEscape={() => setPhoneCheck(false)}
          testId="phone-check-dialog"
          labelledBy="phone-check-title"
        >
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-5 min-[641px]:px-6">
            <SheetDialogTitle asChild>
              <h2 id="phone-check-title" className="text-medium leading-tight font-semibold">
                {t('bulkEmail.phoneCheck.title')}
              </h2>
            </SheetDialogTitle>
            <p className="max-w-[520px] text-button text-muted-foreground">
              {t('bulkEmail.phoneCheck.body')}
            </p>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-border px-5 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] min-[641px]:flex-row min-[641px]:justify-end min-[641px]:px-6">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPhoneCheck(false);
                setOpen(true);
              }}
            >
              {t('bulkEmail.phoneCheck.sendAnyway')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setPhoneCheck(false);
                onShowPhone();
              }}
            >
              {t('bulkEmail.phoneCheck.show')}
            </Button>
          </div>
        </SheetDialog>
      )}
      {open && (
        <SendDialog
          campaignId={campaignId}
          subject={subject}
          audience={audience}
          onClose={() => setOpen(false)}
          onNotReady={(problems) => {
            setOpen(false);
            onProblems(problems);
            setGeneral(problems.filter((p) => !p.blockId));
            setMessage(t('bulkEmail.send.notReady'));
          }}
          onClearProblems={() => onProblems([])}
        />
      )}
    </div>
  );
}

function SendDialog({
  campaignId,
  subject,
  audience,
  onClose,
  onNotReady,
  onClearProblems,
}: {
  campaignId: string;
  subject: string;
  audience: BulkAudience;
  onClose: () => void;
  onNotReady: (problems: BulkNotReadyProblem[]) => void;
  onClearProblems: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // Counted again now, not the builder's debounced value: people may have unsubscribed meanwhile.
  const count = useQuery({
    ...audienceCountQuery(audience),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const sender = useQuery(senderQuery);
  const people = count.data && !count.isFetching ? count.data.count : null;

  const send = useMutation({
    mutationFn: () => sendCampaign(campaignId),
    onMutate: onClearProblems,
    onSuccess: (campaign) => {
      // The page shows the report as soon as the campaign is no longer a draft.
      queryClient.setQueryData(campaignQuery(campaignId).queryKey, campaign);
      void queryClient.invalidateQueries({ queryKey: campaignListKey });
    },
    onError: (error) => {
      const problems = notReadyProblems(error);
      if (problems) onNotReady(problems);
    },
  });

  const code = send.error instanceof ApiError ? send.error.code : undefined;
  const error =
    people === 0 || code === ErrorCodes.emptyAudience
      ? t('bulkEmail.send.emptyAudience')
      : code === ErrorCodes.notDraft
        ? t('bulkEmail.send.notDraft')
        : send.error && !notReadyProblems(send.error)
          ? t('errors.generic')
          : null;

  return (
    <SheetDialog
      onEscape={() => {
        if (!send.isPending) onClose();
      }}
      testId="send-dialog"
      labelledBy="send-dialog-title"
    >
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5 min-[641px]:px-6">
        <SheetDialogTitle asChild>
          <h2 id="send-dialog-title" className="text-medium leading-tight font-semibold">
            {people === null
              ? t('bulkEmail.send.dialogCounting')
              : t('bulkEmail.send.dialogTitle', { count: people })}
          </h2>
        </SheetDialogTitle>
        <dl className="grid gap-x-6 gap-y-3 text-button min-[641px]:grid-cols-[max-content_minmax(0,1fr)]">
          <dt className="text-muted-foreground">{t('bulkEmail.send.subject')}</dt>
          <dd className="font-semibold break-words">{subject}</dd>
          <dt className="text-muted-foreground">{t('bulkEmail.send.sender')}</dt>
          <dd className="break-words">{sender.data ?? (sender.isError ? '' : '…')}</dd>
          <dt className="text-muted-foreground">{t('bulkEmail.send.recipients')}</dt>
          <dd>
            {people === null
              ? t('bulkEmail.send.counting')
              : t('bulkEmail.send.people', { count: people })}
          </dd>
        </dl>
        <p className="text-micro text-muted-foreground">{t('bulkEmail.send.intro')}</p>
        <p role="alert" className="text-button text-error-ink empty:hidden">
          {error}
        </p>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-border px-5 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] min-[641px]:flex-row min-[641px]:justify-end min-[641px]:px-6">
        <Button type="button" variant="ghost" disabled={send.isPending} onClick={onClose}>
          {t('bulkEmail.send.cancel')}
        </Button>
        {code === ErrorCodes.notDraft ? (
          <Button
            type="button"
            onClick={() =>
              void queryClient.invalidateQueries({ queryKey: campaignQuery(campaignId).queryKey })
            }
          >
            {t('bulkEmail.send.reload')}
          </Button>
        ) : (
          <Button
            type="button"
            disabled={!people || send.isPending || code === ErrorCodes.emptyAudience}
            onClick={() => send.mutate()}
          >
            {send.isPending
              ? t('bulkEmail.send.sending')
              : t('bulkEmail.send.confirm', { count: people ?? 0 })}
          </Button>
        )}
      </div>
    </SheetDialog>
  );
}
