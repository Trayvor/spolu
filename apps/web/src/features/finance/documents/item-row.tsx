import { useTranslation } from 'react-i18next';
import { formatMoney, type FinanceItem } from '@spolu/shared';
import { BellIcon, SmallFolderIcon } from '@/features/knowledge/icons';
import { formatPeriod, hasEnded, isEndingSoon } from './format';
import { KIND_ICONS } from './new-menu';

/**
 * One row of the Documents card: the kind's tile, the title (a contract's number before it), a
 * line with the period or the file count, and for a contract its amount on the right in tabular
 * figures, so a column of contracts reads like a ledger. Marks: "Ending soon" (attention), "Ended",
 * "No file", and a bell for an upcoming reminder. A search result names its folder path.
 */
export function ItemRow({
  item,
  today,
  onOpen,
}: {
  item: FinanceItem;
  today: string;
  onOpen: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const Glyph = KIND_ICONS[item.type];
  const contract = item.contract;
  const soon = contract !== null && isEndingSoon(contract.endsOn, today);
  const ended = contract !== null && hasEnded(contract.endsOn, today);

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item.id)}
        data-testid="finance-item-row"
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground"
        >
          <Glyph />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            {contract?.contractNumber && (
              <span className="shrink-0 text-tiny text-muted-foreground tabular-nums">
                <span className="sr-only">
                  {t('financeDocuments.row.number', { number: contract.contractNumber })}
                </span>
                <span aria-hidden="true">{contract.contractNumber}</span>
              </span>
            )}
            <span className="truncate text-button font-semibold">{item.title}</span>
            {item.hasUpcomingReminder && (
              <span
                className="shrink-0 text-muted-foreground"
                title={t('financeDocuments.row.reminder')}
              >
                <BellIcon />
                <span className="sr-only">{t('financeDocuments.row.reminder')}</span>
              </span>
            )}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-tiny text-muted-foreground">
            {contract && (
              <span className="tabular-nums">
                {formatPeriod(contract.startsOn, contract.endsOn, i18n.language)}
              </span>
            )}
            {soon && (
              <span className="rounded-full bg-attention px-2 text-micro font-semibold text-attention-foreground">
                {t('financeDocuments.row.endingSoon')}
              </span>
            )}
            {ended && <span>{t('financeDocuments.row.ended')}</span>}
            {contract && item.fileCount === 0 ? (
              <span>{t('financeDocuments.row.noFile')}</span>
            ) : (
              item.fileCount > 0 && (
                <span>{t('financeDocuments.row.files', { count: item.fileCount })}</span>
              )
            )}
            {item.folderPath && item.folderPath.length > 0 && (
              <span className="flex min-w-0 items-center gap-1">
                <SmallFolderIcon />
                <span className="truncate">{item.folderPath.join(' / ')}</span>
              </span>
            )}
          </span>
        </span>
        {contract && (
          <span className="shrink-0 text-right text-button font-semibold tabular-nums">
            {formatMoney(contract.amount, i18n.language)}
          </span>
        )}
      </button>
    </li>
  );
}
