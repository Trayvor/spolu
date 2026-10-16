import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { BulkCampaignListItem } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { campaignListKey, campaignsQuery, createCampaign } from './api';
import { StatusBadge, formatDateTime } from './parts';
import { useBulkEvents } from './use-bulk-events';

/** `/bulk-email`: every campaign, last changed first, and "New email". */
export function CampaignListPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useInfiniteQuery(campaignsQuery);
  useBulkEvents();

  const create = useMutation({
    // The name is only for admins; it can be changed in the editor right away.
    mutationFn: () =>
      createCampaign(
        t('bulkEmail.list.defaultName', {
          date: formatDateTime(new Date().toISOString(), i18n.language),
        }),
      ),
    onSuccess: async (campaign) => {
      void queryClient.invalidateQueries({ queryKey: campaignListKey });
      await navigate({ to: '/bulk-email/$campaignId', params: { campaignId: campaign.id } });
    },
  });

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex max-w-[880px] flex-col gap-6">
      <div className="flex flex-col gap-4 min-[641px]:flex-row min-[641px]:items-start min-[641px]:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-medium leading-tight font-semibold">{t('bulkEmail.list.title')}</h1>
          <p className="max-w-[60ch] text-button text-muted-foreground">
            {t('bulkEmail.list.intro')}
          </p>
        </div>
        <Button
          className="w-full min-[641px]:w-auto"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          {t('bulkEmail.list.new')}
        </Button>
      </div>
      {create.isError && (
        <p role="alert" className="text-micro text-error-ink">
          {t('errors.generic')}
        </p>
      )}

      {list.isError && (
        <p role="alert" className="text-button text-error-ink">
          {t('errors.generic')}
        </p>
      )}
      {list.isSuccess && items.length === 0 && (
        <Card className="px-5 text-button text-muted-foreground">{t('bulkEmail.list.empty')}</Card>
      )}
      {items.length > 0 && (
        <Card className="gap-0 py-0">
          <ul>
            {items.map((item) => (
              <CampaignRow key={item.id} item={item} />
            ))}
          </ul>
        </Card>
      )}
      {list.hasNextPage && (
        <Button
          variant="secondary"
          className="self-start"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('bulkEmail.list.more')}
        </Button>
      )}
    </div>
  );
}

function CampaignRow({ item }: { item: BulkCampaignListItem }) {
  const { t, i18n } = useTranslation();
  const { counts } = item;
  return (
    <li className="relative flex flex-col gap-1.5 px-5 py-4 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          to="/bulk-email/$campaignId"
          params={{ campaignId: item.id }}
          className="min-w-0 font-semibold break-words after:absolute after:inset-0 hover:underline"
        >
          {item.name}
        </Link>
        <StatusBadge status={item.status} />
      </div>
      <p className="truncate text-button">
        {item.subject || (
          <span className="text-muted-foreground">{t('bulkEmail.list.noSubject')}</span>
        )}
      </p>
      <p className="text-micro text-muted-foreground">
        {item.status !== 'draft' &&
          `${t('bulkEmail.list.counts', { sent: counts.sent, failed: counts.failed })} · `}
        {item.createdByName
          ? t('bulkEmail.list.changedBy', {
              date: formatDateTime(item.updatedAt, i18n.language),
              name: item.createdByName,
            })
          : t('bulkEmail.list.changed', { date: formatDateTime(item.updatedAt, i18n.language) })}
      </p>
    </li>
  );
}
