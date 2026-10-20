import { useTranslation } from 'react-i18next';
import { formatMoney, type FinanceItem } from '@spolu/shared';
import { BellIcon, SmallFolderIcon } from '@/features/knowledge/icons';
import { formatDay, formatPeriod, hasEnded, isEndingSoon, itemTitle } from './format';
import { KIND_ICONS } from './new-menu';

/**
 * One row of the Documents card: the kind's tile, the title (a contract's number before it), a
 * line with the period or the file count, and for a contract its amount on the right in tabular
 * figures, so a column of contracts reads like a ledger. Marks: "Ending soon" (attention), "Ended",
 * "No file", and a bell for an upcoming reminder. A search result names its folder path. Since
 * Phase 32 E: a contract of several clients names its payer (and on `/finance` how many clients
 * share it; in a client's tab the amount is that client's share), an expense its date and kind.
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
  const expense = item.expense;
  const shared = contract?.shared ?? null;
  const soon = contract !== null && isEndingSoon(contract.endsOn, today);
  const ended = contract !== null && hasEnded(contract.endsOn, today);
  const amount = contract?.amount ?? expense?.amount ?? null;

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
            <span className="truncate text-button font-semibold">{itemTitle(item)}</span>
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
            {expense && (
              <span className="tabular-nums">
                {formatDay(expense.spentOn, i18n.language)}
                {expense.spentOn > today && ` · ${t('financeOrg.row.planned')}`}
              </span>
            )}
            {shared && (
              <span className="min-w-0 truncate">
                {t('financeOrg.row.payer', { name: shared.payerName })}
                {shared.shares.length > 1 &&
                  ` · ${t('financeOrg.row.clients', { count: shared.shares.length })}`}
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
        {amount && (
          <span className="shrink-0 text-right text-button font-semibold tabular-nums">
            {expense && <span aria-hidden="true">−</span>}
            {formatMoney(amount, i18n.language)}
          </span>
        )}
      </button>
    </li>
  );
}
