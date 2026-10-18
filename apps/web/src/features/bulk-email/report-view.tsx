import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useRememberedState } from '@/lib/use-remembered-filters';
import { useTranslation } from 'react-i18next';
import {
  BulkRecipientStatuses,
  ErrorCodes,
  type BulkCampaignDto,
  type BulkRecipientItem,
  type BulkRecipientStatus,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import {
  cancelCampaign,
  campaignListKey,
  campaignQuery,
  duplicateCampaign,
  recipientsQuery,
} from './api';
import { StatusBadge, formatDateTime } from './parts';

/** Reasons the server stores on a row itself; anything else is the provider's own message. */
const KNOWN_REASONS = new Set(['unsubscribed', 'disabled', 'unknown']);

/**
 * The report of a campaign past its draft (spec §6): who sent it when from which address, the
 * numbers, a progress bar while sending (the page refetches on `bulk:updated`), the per-person
 * list with a status filter, Cancel sending while sending, and Duplicate.
 */
export function ReportView({ campaign, back }: { campaign: BulkCampaignDto; back: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { counts } = campaign;
  const total = campaign.recipientCount ?? 0;
  const done = counts.sent + counts.failed + counts.skipped + counts.cancelled;

  return (
    <div className="flex flex-col gap-5">
      {back}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 text-medium leading-tight font-semibold break-words">
            {campaign.name}
          </h1>
          <StatusBadge status={campaign.status} />
        </div>
        <p className="text-body font-semibold break-words">{campaign.subject}</p>
        {campaign.sendStartedAt && (
          <p className="text-button text-muted-foreground">
            {t('bulkEmail.report.started', {
              date: formatDateTime(campaign.sendStartedAt, i18n.language),
              name: campaign.sentByName ?? '',
              sender: campaign.sender ?? '',
            })}{' '}
            {campaign.finishedAt &&
              t('bulkEmail.report.finished', {
                date: formatDateTime(campaign.finishedAt, i18n.language),
              })}
          </p>
        )}
      </div>

      <Card className="gap-5 px-4 py-5 min-[641px]:px-6">
        {campaign.status === 'sending' && <Progress done={done} total={total} />}
        <ul
          role="list"
          aria-label={t('bulkEmail.report.counts')}
          className="grid grid-cols-2 gap-x-4 gap-y-5 min-[641px]:grid-cols-3 min-[961px]:grid-cols-6"
        >
          <Figure label={t('bulkEmail.report.recipients')} value={total} />
          <Figure label={t('bulkEmail.report.sent')} value={counts.sent} />
          <Figure label={t('bulkEmail.report.failed')} value={counts.failed} alert />
          <Figure
            label={t('bulkEmail.report.skipped')}
            value={counts.skipped}
            hint={t('bulkEmail.report.skippedHint')}
          />
          <Figure label={t('bulkEmail.report.cancelled')} value={counts.cancelled} />
          <Figure
            label={t('bulkEmail.report.unsubscribed')}
            value={counts.unsubscribed}
            hint={t('bulkEmail.report.unsubscribedHint')}
          />
        </ul>
        <p className="max-w-[640px] text-micro text-muted-foreground">
          {t('bulkEmail.report.note')}
        </p>
      </Card>

      <Actions campaign={campaign} />
      <PeopleList campaignId={campaign.id} />
    </div>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const { t } = useTranslation();
  const share = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-button font-semibold tabular-nums">
        {t('bulkEmail.report.progress', { done, total })}
      </p>
      <div
        role="progressbar"
        aria-label={t('bulkEmail.report.progressLabel')}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-2 overflow-hidden rounded-full bg-secondary"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  hint,
  alert,
}: {
  label: string;
  value: number;
  hint?: string;
  alert?: boolean;
}) {
  return (
    <li className="flex min-w-0 flex-col gap-0.5">
      <span
        data-value
        className={`text-large leading-none font-semibold tabular-nums ${
          alert && value > 0 ? 'text-error-ink' : ''
        }`}
      >
        {value}
      </span>
      <span className="text-tiny font-semibold">{label}</span>
      {hint && <span className="text-micro text-muted-foreground">{hint}</span>}
    </li>
  );
}

function Actions({ campaign }: { campaign: BulkCampaignDto }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const key = campaignQuery(campaign.id).queryKey;

  const duplicate = useMutation({
    mutationFn: () => duplicateCampaign(campaign.id),
    onSuccess: async (copy) => {
      void queryClient.invalidateQueries({ queryKey: campaignListKey });
      await navigate({ to: '/bulk-email/$campaignId', params: { campaignId: copy.id } });
    },
  });
  const cancel = useMutation({
    mutationFn: () => cancelCampaign(campaign.id),
    onSuccess: (updated) => {
      setConfirmCancel(false);
      queryClient.setQueryData(key, updated);
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: campaignListKey });
    },
    onError: (error) => {
      setConfirmCancel(false);
      // Sending finished meanwhile: show the campaign as it is now.
      if (error instanceof ApiError && error.code === ErrorCodes.notSending) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
  const notSending =
    cancel.error instanceof ApiError && cancel.error.code === ErrorCodes.notSending;

  return (
    <div className="flex flex-col gap-3">
      {campaign.status === 'sending' &&
        (confirmCancel ? (
          <div
            role="group"
            aria-label={t('bulkEmail.report.cancelSending')}
            className="flex flex-col gap-3 rounded-xl border-2 border-destructive bg-card p-4 min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-between"
          >
            <p className="text-button">{t('bulkEmail.report.cancelConfirm')}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                {t('bulkEmail.report.cancelYes')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirmCancel(false)}>
                {t('bulkEmail.report.cancelNo')}
              </Button>
            </div>
          </div>
        ) : null)}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={duplicate.isPending} onClick={() => duplicate.mutate()}>
          {t('bulkEmail.report.duplicate')}
        </Button>
        {campaign.status === 'sending' && !confirmCancel && (
          <Button type="button" variant="outline" onClick={() => setConfirmCancel(true)}>
            {t('bulkEmail.report.cancelSending')}
          </Button>
        )}
      </div>
      {campaign.status !== 'sending' && (
        <p className="text-micro text-muted-foreground">{t('bulkEmail.report.readOnly')}</p>
      )}
      {(duplicate.isError || cancel.isError) && (
        <p role="alert" className="text-micro text-error-ink">
          {notSending ? t('bulkEmail.report.notSending') : t('errors.generic')}
        </p>
      )}
    </div>
  );
}

function PeopleList({ campaignId }: { campaignId: string }) {
  const { t } = useTranslation();
  // The status filter is remembered per campaign for the next visit.
  const [status, setStatus] = useRememberedState<BulkRecipientStatus>(
    `bulkEmailReport:${campaignId}`,
    BulkRecipientStatuses,
  );
  const people = useInfiniteQuery(recipientsQuery(campaignId, status));
  const items = people.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Card className="gap-4 px-4 py-5 min-[641px]:px-6">
      <div className="flex flex-col gap-3 min-[641px]:flex-row min-[641px]:items-end min-[641px]:justify-between">
        <h2 id="report-people" className="text-body font-semibold">
          {t('bulkEmail.report.people')}
        </h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="report-filter">{t('bulkEmail.report.filter')}</Label>
          <Select
            id="report-filter"
            value={status ?? ''}
            onChange={(e) => setStatus((e.target.value || null) as BulkRecipientStatus | null)}
            containerClassName="min-[641px]:w-56"
          >
            <option value="">{t('bulkEmail.report.filterAll')}</option>
            {BulkRecipientStatuses.map((s) => (
              <option key={s} value={s}>
                {t(`bulkEmail.report.recipientStatus.${s}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {people.isError && (
        <p role="alert" className="text-button text-error-ink">
          {t('errors.generic')}
        </p>
      )}
      {people.isSuccess && items.length === 0 && (
        <p className="text-button text-muted-foreground">{t('bulkEmail.report.empty')}</p>
      )}
      <ul role="list" aria-labelledby="report-people">
        {items.map((item) => (
          <PersonRow key={item.userId} item={item} />
        ))}
      </ul>
      {people.hasNextPage && (
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          disabled={people.isFetchingNextPage}
          onClick={() => void people.fetchNextPage()}
        >
          {t('bulkEmail.report.more')}
        </Button>
      )}
    </Card>
  );
}

const STATUS_INK: Partial<Record<BulkRecipientStatus, string>> = {
  sent: 'text-success',
  failed: 'text-error-ink',
};

function PersonRow({ item }: { item: BulkRecipientItem }) {
  const { t, i18n } = useTranslation();
  const reason =
    item.error && KNOWN_REASONS.has(item.error)
      ? t(`bulkEmail.report.reason.${item.error}`)
      : item.error;
  return (
    <li className="grid gap-x-4 gap-y-0.5 py-2.5 min-[641px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-button font-semibold break-words">{item.name || item.email}</span>
        <span className="text-micro break-words text-muted-foreground">{item.email}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 min-[641px]:items-end min-[641px]:text-right">
        <span className={`text-tiny font-semibold ${STATUS_INK[item.status] ?? ''}`}>
          {t(`bulkEmail.report.recipientStatus.${item.status}`)}
        </span>
        {reason && <span className="text-micro break-words text-muted-foreground">{reason}</span>}
        {item.sentAt && (
          <span className="text-micro text-muted-foreground">
            {t('bulkEmail.report.sentAt', { date: formatDateTime(item.sentAt, i18n.language) })}
          </span>
        )}
      </div>
    </li>
  );
}
