import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { BulkAudience } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { audiencePeopleQuery } from './api';

/** "Show recipients": the people who would get the email now, by name, 50 a page. */
export function RecipientsDialog({
  audience,
  onClose,
}: {
  audience: BulkAudience;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const people = useInfiniteQuery(audiencePeopleQuery(audience));
  const items = people.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <SheetDialog onEscape={onClose} testId="recipients-dialog">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <SheetDialogTitle className="text-body font-semibold">
          {t('bulkEmail.recipients.title')}
        </SheetDialogTitle>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('bulkEmail.recipients.close')}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-3">
        {people.isError && (
          <p role="alert" className="text-button text-error-ink">
            {t('errors.generic')}
          </p>
        )}
        {people.isSuccess && items.length === 0 && (
          <p className="text-button text-muted-foreground">{t('bulkEmail.recipients.empty')}</p>
        )}
        <ul>
          {items.map((person) => (
            <li
              key={person.id}
              className="flex flex-col gap-0.5 py-2.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border"
            >
              <span className="text-button font-semibold">{person.name || person.email}</span>
              <span className="text-micro text-muted-foreground">
                {[person.email, t(`bulkEmail.audience.role.${person.role}`), ...person.groups].join(
                  ', ',
                )}
              </span>
            </li>
          ))}
        </ul>
        {people.hasNextPage && (
          <Button
            variant="secondary"
            className="mt-3"
            disabled={people.isFetchingNextPage}
            onClick={() => void people.fetchNextPage()}
          >
            {t('bulkEmail.recipients.more')}
          </Button>
        )}
      </div>
    </SheetDialog>
  );
}
